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
            'anthropic/claude-3-sonnet',
            'google/gemini-2.0-flash-exp:free',
            'meta-llama/llama-3.2-3b-instruct:free'
        ]
    });
});

// Main chat endpoint
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

        // Prepare request to OpenRouter
        const openRouterRequest = {
            model: model || DEFAULT_MODEL,
            messages: messages,
            max_tokens: max_tokens || 1000,
            temperature: temperature !== undefined ? temperature : 0.7
        };

        console.log(`[${new Date().toISOString()}] Chat request - Model: ${openRouterRequest.model}, Messages: ${messages.length}`);

        // Call OpenRouter API
        const response = await axios.post(OPENROUTER_URL, openRouterRequest, {
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': process.env.APP_URL || 'https://your-render-app.onrender.com',
                'X-Title': 'Roblox AI Chatbot'
            },
            timeout: 30000 // 30 second timeout
        });

        // Extract response
        if (response.data.choices && response.data.choices[0]) {
            const aiMessage = response.data.choices[0].message.content;
            
            console.log(`[${new Date().toISOString()}] Response sent successfully`);
            
            return res.json({
                success: true,
                message: aiMessage,
                model: openRouterRequest.model,
                usage: response.data.usage || {}
            });
        } else {
            throw new Error('Unexpected response format from OpenRouter');
        }

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);

        // Handle different error types
        if (error.response) {
            // OpenRouter API error
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
            // Network error
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to reach OpenRouter API'
            });
        } else {
            // Other errors
            return res.status(500).json({
                error: 'Internal server error',
                message: error.message
            });
        }
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
╚═══════════════════════════════════════════╝
    `);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/`);
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
