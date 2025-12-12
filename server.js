const express = require('express');
const axios = require('axios');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' })); // Add size limit
app.use(cors({
    origin: '*', // Allow all origins (Roblox)
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting: 100 requests per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

app.use('/api/', limiter);

// Configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = process.env.MODEL || 'openai/gpt-oss-20b:free';

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
            'meta-llama/llama-3.2-3b-instruct:free',
            'google/gemma-3-12b-it:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'openai/gpt-oss-20b:free',
        ]
    });
});

// Helper function to call OpenRouter API
async function callOpenRouter(messages, model, maxTokens = 1000, temperature = 0.7) {
    try {
        // Validate messages format
        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error('Messages must be a non-empty array');
        }

        // Validate each message has required fields
        for (const msg of messages) {
            if (!msg.role || !msg.content) {
                throw new Error('Each message must have role and content');
            }
            if (!['user', 'assistant', 'system'].includes(msg.role)) {
                throw new Error('Message role must be user, assistant, or system');
            }
        }

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
            timeout: 60000 // Increased to 60 seconds for larger models
        });

        if (response.data.choices && response.data.choices[0]) {
            return {
                message: response.data.choices[0].message.content,
                usage: response.data.usage || {},
                finish_reason: response.data.choices[0].finish_reason
            };
        } else {
            throw new Error('Unexpected response format from OpenRouter');
        }
    } catch (error) {
        // Re-throw with more context
        if (error.response) {
            const err = new Error(error.response.data?.error?.message || 'OpenRouter API error');
            err.status = error.response.status;
            err.data = error.response.data;
            throw err;
        }
        throw error;
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
                message: 'Messages array is required and must not be empty'
            });
        }

        // Validate message format
        for (const msg of messages) {
            if (!msg.role || !msg.content) {
                return res.status(400).json({
                    error: 'Invalid message format',
                    message: 'Each message must have role and content fields'
                });
            }
        }

        // Check API key
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'OpenRouter API key not configured'
            });
        }

        // Validate parameters
        const selectedModel = model || DEFAULT_MODEL;
        const validatedMaxTokens = max_tokens && max_tokens > 0 ? Math.min(max_tokens, 4000) : 1000;
        const validatedTemperature = temperature !== undefined ? Math.max(0, Math.min(temperature, 2)) : 0.7;

        console.log(`[${new Date().toISOString()}] Chat request - Model: ${selectedModel}, Messages: ${messages.length}`);

        // Call OpenRouter API
        const result = await callOpenRouter(messages, selectedModel, validatedMaxTokens, validatedTemperature);

        console.log(`[${new Date().toISOString()}] Response sent successfully`);

        return res.json({
            success: true,
            message: result.message,
            model: selectedModel,
            usage: result.usage,
            finish_reason: result.finish_reason
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);

        // Handle different error types
        if (error.status) {
            const status = error.status;
            const data = error.data;

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
            } else if (status === 400) {
                return res.status(400).json({
                    error: 'Bad request',
                    message: data?.error?.message || 'Invalid request to OpenRouter API'
                });
            }

            return res.status(status).json({
                error: 'OpenRouter API error',
                message: data?.error?.message || 'Unknown error occurred'
            });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return res.status(504).json({
                error: 'Gateway timeout',
                message: 'Request to OpenRouter API timed out'
            });
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
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
                message: 'Messages array is required and must not be empty'
            });
        }

        if (!models || !Array.isArray(models) || models.length === 0) {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'Models array is required for compare mode'
            });
        }

        // Limit number of models to prevent abuse
        if (models.length > 5) {
            return res.status(400).json({
                error: 'Too many models',
                message: 'Maximum 5 models allowed in compare mode'
            });
        }

        // Validate message format
        for (const msg of messages) {
            if (!msg.role || !msg.content) {
                return res.status(400).json({
                    error: 'Invalid message format',
                    message: 'Each message must have role and content fields'
                });
            }
        }

        // Check API key
        if (!OPENROUTER_API_KEY) {
            return res.status(500).json({
                error: 'Server configuration error',
                message: 'OpenRouter API key not configured'
            });
        }

        // Validate parameters
        const validatedMaxTokens = max_tokens && max_tokens > 0 ? Math.min(max_tokens, 4000) : 1000;
        const validatedTemperature = temperature !== undefined ? Math.max(0, Math.min(temperature, 2)) : 0.7;

        console.log(`[${new Date().toISOString()}] Compare request - Models: ${models.join(', ')}, Messages: ${messages.length}`);

        // Call all models in parallel
        const promises = models.map(model => 
            callOpenRouter(messages, model, validatedMaxTokens, validatedTemperature)
                .then(result => ({
                    success: true,
                    model: model,
                    message: result.message,
                    usage: result.usage,
                    finish_reason: result.finish_reason
                }))
                .catch(error => ({
                    success: false,
                    model: model,
                    message: error.message || 'Request failed',
                    error: true,
                    error_type: error.status || 'unknown'
                }))
        );

        const results = await Promise.all(promises);

        console.log(`[${new Date().toISOString()}] Compare responses sent successfully`);

        return res.json({
            success: true,
            results: results,
            timestamp: new Date().toISOString()
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
        message: 'Endpoint not found',
        path: req.path
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║  🤖 Roblox AI Chatbot Proxy Server       ║
║  📡 Port: ${PORT.toString().padEnd(31)}║
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
    console.log(`  - GET /api/models (available models)`);
});

// Graceful shutdown
const gracefulShutdown = () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
        console.error('⚠️  Forcing shutdown');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
