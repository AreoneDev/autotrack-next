/** @jest-environment jsdom */
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Autocomplete from "@/components/ui/Autocomplete";

function Form() {
    const [value, setValue] = useState("");
    return <form><Autocomplete label="Make" value={value} options={["Toyota", "Honda"]}
        placeholder="Any make" onChange={setValue} onSelect={setValue} /><button>Save</button></form>;
}

test("A11Y-AC-01: ArrowDown/Up, Enter select, Escape and Tab dismiss without losing custom text", async () => {
    render(<Form />);
    const user = userEvent.setup();
    const input = screen.getByRole("combobox", { name: "Make" });
    await user.tab();
    expect(input).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    const first = screen.getByRole("option", { name: "Toyota" });
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
    expect(input).toHaveValue("Toyota");
    expect(input).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.clear(input); await user.type(input, "Custom");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("Custom");
    expect(input).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowDown}{Tab}");
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");
});
