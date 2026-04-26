import os
from typing import Annotated
from dotenv import load_dotenv
from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential
from azure.ai.agentserver.agentframework import from_agent_framework

# Load environment variables
load_dotenv(override=False)

# Define tools for real estate inquiries
def answer_real_estate_question(
    question: Annotated[str, "The real estate question to answer."]
) -> str:
    """Answer a general real estate question."""
    # In a real implementation, this could call an AI service or knowledge base
    # For now, return a helpful response
    return f"Regarding your question '{question}': As a real estate professional, I'd recommend consulting with a local agent for the most current and personalized advice. Generally, market conditions vary by location and timing."

def get_property_advice(
    property_type: Annotated[str, "Type of property: house, apartment, condo, etc."],
    purpose: Annotated[str, "Purpose: buy, sell, rent, invest"]
) -> str:
    """Provide advice for a specific property type and purpose."""
    advice = {
        "buy": f"When buying a {property_type}, consider factors like location, condition, financing options, and market trends. Get a professional inspection and work with a buyer's agent.",
        "sell": f"To sell a {property_type}, focus on staging, pricing competitively, and marketing effectively. Consider timing and local market conditions.",
        "rent": f"For renting a {property_type}, check rental history, credit, and income requirements. Look for properties in good condition with reasonable lease terms.",
        "invest": f"Investing in {property_type}s requires research into cash flow, appreciation potential, and market stability. Consider consulting a financial advisor."
    }
    return advice.get(purpose.lower(), f"For {purpose} a {property_type}, professional guidance is recommended.")

def get_market_trend(
    location: Annotated[str, "The city or area to get market trends for."]
) -> str:
    """Get market trend information for a location."""
    # Mock market data
    return f"Market trends for {location}: Current conditions show moderate activity with average days on market around 30 days. Prices have been stable with slight upward pressure. Contact a local agent for the latest data."

async def main():
    # Initialize Foundry client
    client = FoundryChatClient(
        project_endpoint=os.getenv("FOUNDRY_PROJECT_ENDPOINT"),
        model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME"),
        credential=DefaultAzureCredential(),
    )

    # Create the real estate inquiries agent
    agent = Agent(
        client,
        name="RealEstateInquiriesAgent",
        instructions="""
        You are a helpful real estate inquiry assistant. Help users with questions about:
        - Buying, selling, or renting properties
        - Real estate market trends and conditions
        - Property types and investment advice
        - General real estate knowledge and processes

        Always be professional, informative, and helpful. Use the available tools to provide specific information when possible.
        If you don't have specific data, suggest next steps or recommend consulting a local professional.
        Provide accurate, up-to-date information and avoid giving financial or legal advice.
        """,
        tools=[answer_real_estate_question, get_property_advice, get_market_trend],
    )

    # Run the agent as an HTTP server
    await from_agent_framework(agent).run_async()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())