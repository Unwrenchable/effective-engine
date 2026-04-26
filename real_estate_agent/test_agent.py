import os
from dotenv import load_dotenv
from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential

# Load environment variables
load_dotenv()

def test_agent_creation():
    """Test that the agent can be created without errors."""
    try:
        # Initialize Foundry client
        client = FoundryChatClient(
            project_endpoint=os.getenv("FOUNDRY_PROJECT_ENDPOINT"),
            model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME"),
            credential=DefaultAzureCredential(),
        )

        # Define simple tools
        def get_listing_info(location: str) -> str:
            return f"Mock listing info for {location}"

        # Create the agent
        agent = Agent(
            client,
            name="TestAgent",
            instructions="Test agent for verification.",
            tools=[get_listing_info],
        )

        print("✓ Agent created successfully")
        return True

    except Exception as e:
        print(f"✗ Agent creation failed: {e}")
        return False

if __name__ == "__main__":
    success = test_agent_creation()
    if success:
        print("Verification passed: Agent can be initialized.")
    else:
        print("Verification failed: Check configuration and dependencies.")