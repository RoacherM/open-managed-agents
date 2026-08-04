import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import yaml from "js-yaml";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentFormDialog } from "./AgentFormDialog";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    setPointerCapture: { configurable: true, value: () => {} },
    releasePointerCapture: { configurable: true, value: () => {} },
    scrollIntoView: { configurable: true, value: () => {} },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("AgentFormDialog harness selection", () => {
  it("round-trips Pi through Form/YAML and submits the canonical _oma field on Node", async () => {
    const modelCard = {
      id: "mc_pi",
      model_id: "deepseek-v4-pro",
      model: "deepseek-v4-pro",
      provider: "oai-compatible",
      is_default: true,
    };
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/health") return Response.json({ status: "ok", runtime: "node" });
      if (url === "/v1/model_cards/mc_pi") return Response.json(modelCard);
      if (url === "/v1/agents" && init?.method === "POST") {
        submitted = JSON.parse(String(init.body));
        return Response.json({ id: "agent_pi" });
      }
      throw new Error(`unexpected request: ${url}`);
    }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AgentFormDialog
            open
            onClose={() => {}}
            allAgents={[]}
            customSkills={[]}
            modelCards={[modelCard] as never}
            runtimes={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: /Blank agent config/i }));
    await userEvent.type(screen.getByLabelText("Name *"), "Pi Agent");
    await userEvent.click(await screen.findByRole("combobox", { name: "Select harness" }));
    await userEvent.click(await screen.findByRole("option", { name: /Pi.*Node self-host/i }));

    await userEvent.click(screen.getByRole("button", { name: "YAML" }));
    const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect((yaml.load(editor.value) as any)._oma.harness).toBe("pi");

    await userEvent.click(screen.getByRole("button", { name: "Form" }));
    await userEvent.click(screen.getByRole("button", { name: "Create Agent" }));
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted?._oma).toEqual({ harness: "pi" });
  });
});
