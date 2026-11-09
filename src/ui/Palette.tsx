import { Pipette } from "lucide-react";

const PALETTE = [
  "#ffffff", "#f2c9a0", "#c68642", "#8d5524",
  "#e5484d", "#f76b15", "#ffc53d", "#3fae5a",
  "#1ef5a6", "#12a594", "#3f8cff", "#2d3a55",
  "#7a3fd1", "#e93d82", "#8a9bb0", "#2b2f38",
];

export function Palette({ value, onPick }: { value: string; onPick(color: string): void }) {
  return (
    <div className="palette">
      {PALETTE.map((color) => (
        <button
          key={color}
          className={`swatch ${color === value ? "active" : ""}`}
          style={{ background: color }}
          onClick={() => onPick(color)}
          aria-label={`Cor ${color}`}
        />
      ))}
      <label className="swatch custom" title="Escolher outra cor">
        <Pipette size={14} />
        <input type="color" value={value || "#ffffff"} onChange={(event) => onPick(event.target.value)} />
      </label>
    </div>
  );
}
