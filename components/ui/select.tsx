"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Lista suspensa da identidade (popover sólido com tokens), no lugar do <select> nativo,
// cujo menu é desenhado pelo sistema e fica ilegível no tema escuro.
// Mesma API do nativo: filhos <option>, `value` e `onChange(e)` com `e.target.value` (sempre string).

type Option = { value: string; label: React.ReactNode; disabled?: boolean };

type SelectProps = {
  value: string | number;
  onChange?: (e: { target: { value: string } }) => void;
  children: React.ReactNode;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
};

function collectOptions(children: React.ReactNode, out: Option[] = []): Option[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === "option") {
      const { value, children: label, disabled } = child.props;
      out.push({ value: String(value ?? ""), label, disabled });
    } else if (child.props.children) {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

function Select({ value, onChange, children, className, id, name, required, disabled, "aria-label": ariaLabel }: SelectProps) {
  const options = collectOptions(children);
  const [open, setOpen] = React.useState(false);

  return (
    <SelectPrimitive.Root
      items={options}
      value={String(value)}
      onValueChange={(v) => onChange?.({ target: { value: String(v ?? "") } })}
      open={open}
      onOpenChange={setOpen}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        data-slot="select"
        className={cn(
          "inline-flex cursor-default items-center justify-between gap-2 text-left whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-ring",
          className,
        )}
      >
        {/* Rótulos invisíveis empilhados: a largura acompanha a opção mais longa, como no nativo. */}
        <span className="grid min-w-0 grid-cols-[minmax(0,max-content)]">
          <SelectPrimitive.Value className="truncate [grid-area:1/1]" />
          {options.map((o) => (
            <span key={o.value} aria-hidden className="invisible h-0 pr-px whitespace-nowrap [grid-area:1/1]">
              {o.label}
            </span>
          ))}
        </span>
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground transition-transform duration-150 in-data-popup-open:rotate-180">
          <ChevronDown className="size-4" strokeWidth={1.75} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-[60] outline-none select-none" sideOffset={4} alignItemWithTrigger={false}>
          <SelectPrimitive.Popup
            className="max-w-[min(32rem,calc(100vw-2rem))] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] rounded-lg border bg-popover p-1 text-popover-foreground shadow-[var(--glass-shadow)] outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0"
            // Teclas do menu não chegam aos diálogos/drawers por trás (Esc fecharia o diálogo, Tab cairia no trapFocus).
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                e.nativeEvent.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <SelectPrimitive.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto scroll-py-1">
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className="flex min-h-10 cursor-default items-center gap-2 rounded-md py-2 pr-2.5 pl-2.5 text-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-secondary data-highlighted:text-secondary-foreground data-selected:font-medium"
                >
                  <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate">{o.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="shrink-0 text-brand-mid">
                    <Check className="size-4" strokeWidth={1.75} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { Select };
