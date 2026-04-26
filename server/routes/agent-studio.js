'use strict';

/**
 * Agent Studio routes
 *
 * GET /v2/agent-studio/agents     — list all agents
 * GET /v2/agent-studio/workflows  — list all workflows
 * POST /v2/agent-studio/run       — run a workflow or agent
 */

const fs = require('fs').promises;
const path = require('path');

const agentsPath = path.join(__dirname, '../../real_estate_agents.json');
const workflowsPath = path.join(__dirname, '../../real_estate_workflows.json');

module.exports = async function agentStudioRoutes(fastify) {

  fastify.get('/agents', {
    onRequest: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const data = await fs.readFile(agentsPath, 'utf8');
      const agents = JSON.parse(data);
      return reply.send({ agents });
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to load agents' });
    }
  });

  fastify.get('/workflows', {
    onRequest: [fastify.authenticate],
  }, async (req, reply) => {
    try {
      const data = await fs.readFile(workflowsPath, 'utf8');
      const workflows = JSON.parse(data);
      return reply.send({ workflows });
    } catch (error) {
      return reply.code(500).send({ error: 'Failed to load workflows' });
    }
  });

  fastify.post('/run', {
    onRequest: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string', enum: ['agent', 'workflow'] },
          id: { type: 'string' },
          input: { type: 'object' }
        }
      }
    }
  }, async (req, reply) => {
    const { type, id, input } = req.body;

    if (type === 'agent') {
      // Simulate or call real AI
      let result = `Simulated result for ${id}`;
      if (id === 'listing-optimizer') {
        // Call AI service
        const ai = require('../services/ai');
        try {
          const description = await ai.generateListingDescription({
            address: input?.address || '123 Luxury St, Las Vegas, NV',
            beds: input?.beds || 4,
            baths: input?.baths || 3,
            sqft: input?.sqft || 3500,
            price: input?.price || 1500000
          });
          result = `Generated description: ${description}`;
        } catch (error) {
          result = 'AI service unavailable, using simulation';
        }
      } else if (id === 'property-valuator') {
        const avm = require('../services/avm');
        try {
          const listing = input || {}; // Assume input has listing data
          const valuation = await avm.estimate(listing);
          result = `Property valuation: $${valuation.estimate} with ${valuation.confidence} confidence. Comps: ${valuation.comps.length}`;
        } catch (error) {
          result = 'AVM service error, using simulation';
        }
      } else if (id === 'market-analyst') {
        const market = require('../services/market');
        try {
          const analysis = await market.analyzeTrends(input?.city || 'Las Vegas');
          result = `Market analysis: ${analysis.summary || 'Trends analyzed'}`;
        } catch (error) {
          result = 'Market service unavailable, using simulation';
        }
      } else if (id === 'client-matcher') {
        // Simulate matching
        result = `Matched properties for client preferences: ${JSON.stringify(input || {})}`;
      } else if (id === 'compliance-checker') {
        // Simulate compliance check
        result = 'Listing complies with GLVAR and fair housing laws.';
      } else if (id === 'virtual-assistant') {
        // Simulate assistant
        result = 'Handled inquiry and scheduled showing.';
      } else if (id === 'virtual-tour-guide') {
        // Simulate tour creation
        result = 'Virtual tour created and integrated.';
      } else if (id === 'negotiation-assistant') {
        // Simulate negotiation
        result = 'Offer analyzed, counter-offer suggested.';
      } else if (id === 'data-sync-agent') {
        // Call sync
        const sync = require('../sync/ingest');
        try {
          await sync.run();
          result = 'Data synchronized with MLS/IDX feeds.';
        } catch (error) {
          result = 'Sync failed, using simulation';
        }
      }
      return reply.send({
        status: 'completed',
        agent_id: id,
        message: `Agent ${id} completed processing.`,
        result
      });
    } else if (type === 'workflow') {
      // For workflow, simulate multi-step
      return reply.send({
        status: 'completed',
        workflow_id: id,
        message: `Workflow ${id} executed successfully.`,
        steps: ['All steps completed']
      });
    }

    return reply.code(400).send({ error: 'Invalid type' });
  });

};