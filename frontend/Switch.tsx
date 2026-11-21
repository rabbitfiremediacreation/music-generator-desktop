import type { ComponentProps, ReactNode } from "react";
import "./switch.css";

type SwitchProps = Omit<ComponentProps<"input">, "type" | "role" | "className" | "children"> & {
  label: ReactNode;
  className?: string;
  status?: string;
};

export function Switch({ label, className = "", status, ...input }: SwitchProps) {
  return <label className={className ? `ui-switch-row ${className}` : "ui-switch-row"}>
    <span className="ui-switch-label">{label}</span>
    {status && <span className="ui-switch-status" aria-hidden="true">{status}</span>}
    <input {...input} className="ui-switch" type="checkbox" role="switch" />
  </label>;
}
