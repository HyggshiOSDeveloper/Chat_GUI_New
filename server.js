const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*', // Allow all origins (Roblox)
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', limiter);

// Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.MODEL || 'openai/gpt-4o-mini';

// Validate API key on startup
if (!OPENROUTER_API_KEY) {
    console.error('⚠️  WARNING: OPENROUTER_API_KEY not set in environment variables!');
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Roblox AI Chatbot Proxy Server',
        endpoints: {
            health: 'GET /',
            chat: 'POST /api/chat',
            compare: 'POST /api/compare',
            models: 'GET /api/models'
        },
        timestamp: new Date().toISOString()
    });
});

// Models endpoint
app.get('/api/models', (req, res) => {
    res.json({
        current: DEFAULT_MODEL,
        available: [
            'openai/gpt-4o',
            'openai/gpt-4o-mini',
            'openai/gpt-4-turbo',
            'anthropic/claude-3.5-sonnet',
            'anthropic/claude-sonnet-4.5',
            'google/gemini-2.0-flash-exp:free',
            'meta-llama/llama-3.2-3b-instruct:free'
        ]
    });
});

// Helper function to call OpenRouter API
async function callOpenRouter(messages, model, maxTokens = 1000, temperature = 0.7) {
    const openRouterRequest = {
        model: model,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature
    };

    const response = await axios.post(OPENROUTER_URL, openRouterRequest, {
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.APP_URL || 'https://your-render-app.onrender.com',
            'X-Title': 'Roblox AI Chatbot'
        },
        timeout: 30000 // 30 second timeout
    });

    if (response.data.choices && response.data.choices[0]) {
        return {
            message: response.data.choices[0].message.content,
            usage: response.data.usage || {}
        };
    } else {
        throw new Error('Unexpected response format from OpenRouter');
    }
}

// Main chat endpoint (single model)
app.post('/api/chat', async (req, res) => {
    try {
        const { messages, model, max_tokens, temperature } = req.body;

        // Validation
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Messages array is required'
            });
        }

        // Check API key
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'OpenRouter API key not configured'
            });
        }

        const selectedModel = model || DEFAULT_MODEL;
        console.log(`[${new Date().toISOString()}] Chat request - Model: ${selectedModel}, Messages: ${messages.length}`);

        // Call OpenRouter API
        const result = await callOpenRouter(messages, selectedModel, max_tokens, temperature);

        console.log(`[${new Date().toISOString()}] Response sent successfully`);

        return res.json({
            success: true,
            message: result.message,
            model: selectedModel,
            usage: result.usage
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);

        // Handle different error types
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            console.error('OpenRouter Error:', status, data);

            if (status === 401) {
                return res.status(401).json({
                    error: 'Authentication failed',
                    message: 'Invalid OpenRouter API key'
                });
            } else if (status === 402) {
                return res.status(402).json({
                    error: 'Payment required',
                    message: 'Insufficient credits on OpenRouter account'
                });
            } else if (status === 429) {
                return res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: 'Too many requests to OpenRouter API'
                });
            } else if (status === 404) {
                return res.status(404).json({
                    error: 'Model not found',
                    message: 'The specified model is not available'
                });
            }

            return res.status(status).json({
                error: 'OpenRouter API error',
                message: data.error?.message || 'Unknown error occurred'
            });
        } else if (error.request) {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to reach OpenRouter API'
            });
        } else {
            return res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
    }
});

// Compare mode endpoint (multiple models simultaneously)
app.post('/api/compare', async (req, res) => {
    try {
        const { messages, models, max_tokens, temperature } = req.body;

        // Validation
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Messages array is required'
            });
        }

        if (!models || !Array.isArray(models) || models.length === 0) {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Models array is required for compare mode'
            });
        }

        // Check API key
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'OpenRouter API key not configured'
            });
        }

        console.log(`[${new Date().toISOString()}] Compare request - Models: ${models.join(', ')}, Messages: ${messages.length}`);

        // Call all models in parallel
        const promises = models.map(model => 
            callOpenRouter(messages, model, max_tokens, temperature)
                .then(result => ({
                    success: true,
                    model: model,
                    message: result.message,
                    usage: result.usage
                }))
                .catch(error => ({
                    success: false,
                    model: model,
                    message: error.response?.data?.error?.message || error.message || 'Request failed',
                    error: true
                }))
        );

        const results = await Promise.all(promises);

        console.log(`[${new Date().toISOString()}] Compare responses sent successfully`);

        return res.json({
            success: true,
            results: results
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Compare Error:`, error.message);

        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║  🤖 Roblox AI Chatbot Proxy Server       ║
║  📡 Port: ${PORT}                         ║
║  🌐 Status: Online                        ║
║  🔑 API Key: ${OPENROUTER_API_KEY ? '✓ Configured' : '✗ Missing'}        ║
║  ⚖️  Compare Mode: Enabled                ║
╚═══════════════════════════════════════════╝
    `);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/`);
    console.log(`Endpoints:`);
    console.log(`  - POST /api/chat (single model)`);
    console.log(`  - POST /api/compare (multiple models)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    process.exit(0);
});
