import { CopilotKit } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import { COPILOTKIT_RUNTIME_CONFIG } from "./copilotkit-config";

function App() {
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ padding: "1rem", background: "#f5f5f5", borderBottom: "1px solid #ddd" }}>
        <h1>Shortlet Concierge Test Shell</h1>
        <p>Use this shell to drive the application via go-rod.</p>
      </header>
      
      <main style={{ flex: 1, padding: "2rem" }}>
        <p>The CopilotKit conversational interface is running on the right side.</p>
        <p>You can interact with the agent or trigger conventional UI states here.</p>
        {/* Placeholder for @ag-ui/core components or conventional UI pieces */}
      </main>

      <CopilotKit {...COPILOTKIT_RUNTIME_CONFIG}>
        <CopilotSidebar
          defaultOpen={true}
          labels={{
            title: "Shortlet Concierge Agent",
            initial: "Hi! How can I help you today?",
          }}
        />
      </CopilotKit>
    </div>
  );
}

export default App;
