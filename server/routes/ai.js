'use strict';

/**
 * AI Chat routes
 */

const ai = require('../services/ai');

module.exports = async function aiRoutes(fastify) {
  fastify.post('/chat', {
    schema: {
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { message } = req.body;

    try {
      // Use AI service to generate response
      const response = await ai.generateChatResponse(message);
      return reply.send({ response });
    } catch (error) {
      console.error('AI chat error:', error);
      return reply.send({ response: 'I\'m here to help you find your dream home. What are you looking for?' });
    }
  });
};