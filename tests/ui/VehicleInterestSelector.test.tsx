/** @jest-environment jsdom */
import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleInterestSelector from "@/components/leads/VehicleInterestSelector";
import { VehicleSelectionService, type VehicleSelection } from "@/domain/business/VehicleSelectionService";

jest.mock("@/domain/business/VehicleSelectionService");
jest.mock("@/lib/supabase/client", () => ({ supabase: {} }));

const full: VehicleSelection = { year: "2026", make: "Toyota", model: "RAV4", trim: "XLE" };
function Form({ initial = full, disabled = false }: { initial?: VehicleSelection; disabled?: boolean }) {
    const [value, setValue] = useState(initial);
    return <VehicleInterestSelector value={value} onChange={setValue} disabled={disabled} />;
}

async function renderForm(props: Parameters<typeof Form>[0] = {}) {
    await act(async () => { render(<Form {...props} />); });
}

describe("UI-VEH — cascading selection state transitions", () => {
    beforeEach(() => {
        jest.mocked(VehicleSelectionService).mockImplementation(() => ({
            searchYears: jest.fn().mockResolvedValue([2026, 2025]),
            searchMakes: jest.fn().mockResolvedValue(["Toyota", "Honda"]),
            searchModels: jest.fn().mockResolvedValue(["RAV4"]),
            searchTrims: jest.fn().mockResolvedValue(["XLE"]),
        }) as unknown as VehicleSelectionService);
    });

    it("UI-VEH-01: empty selection disables dependent fields", async () => {
        await renderForm({ initial: { year: "", make: "", model: "", trim: "" } });
        expect(screen.getByRole("combobox", { name: "Year" })).toBeEnabled();
        for (const name of ["Make", "Model", "Trim"]) expect(screen.getByRole("combobox", { name })).toBeDisabled();
    });

    it.each([
        ["Year", ["Make", "Model", "Trim"]],
        ["Make", ["Model", "Trim"]],
        ["Model", ["Trim"]],
    ])("UI-VEH-02: changing %s clears dependent values", async (name, descendants) => {
        await renderForm();
        const user = userEvent.setup();
        await user.clear(screen.getByRole("combobox", { name: name as string }));
        for (const descendant of descendants as string[]) expect(screen.getByRole("combobox", { name: descendant })).toHaveValue("");
    });

    it("UI-VEH-03: choosing a suggestion updates the controlled field", async () => {
        await renderForm({ initial: { year: "", make: "", model: "", trim: "" } });
        const user = userEvent.setup();
        await user.click(screen.getByRole("combobox", { name: "Year" }));
        await user.click(await screen.findByRole("option", { name: "2026" }));
        expect(screen.getByRole("combobox", { name: "Year" })).toHaveValue("2026");
        expect(screen.getByRole("combobox", { name: "Make" })).toBeEnabled();
        expect(screen.getByRole("combobox", { name: "Model" })).toBeDisabled();
    });

    it("UI-VEH-04: custom optional trim is accepted without altering parent values", async () => {
        await renderForm();
        const user = userEvent.setup();
        await user.clear(screen.getByRole("combobox", { name: "Trim" }));
        await user.type(screen.getByRole("combobox", { name: "Trim" }), "Custom");
        expect(screen.getByRole("combobox", { name: "Trim" })).toHaveValue("Custom");
        expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("RAV4");
    });

    it("UI-VEH-05: read-only selection disables every input", async () => {
        await renderForm({ disabled: true });
        screen.getAllByRole("combobox").forEach((input) => expect(input).toBeDisabled());
    });
});
