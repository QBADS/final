import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

interface GaugeProps {
  value: number;
  max: number;
  label: string;
  color?: string;
}

export function Gauge({ value, max, label, color = "var(--amber)" }: GaugeProps) {
  const data = [
    { name: "value", v: value },
    { name: "rest", v: Math.max(max - value, 0) },
  ];
  return (
    <div className="flex flex-col items-center gap-1.5 pt-1.5 pb-0.5">
      <div style={{ width: "100%", maxWidth: 220, height: 110 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="v"
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius="130%"
              outerRadius="220%"
              stroke="none"
            >
              <Cell fill={color} />
              <Cell fill="rgba(255,255,255,0.06)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="qb-gauge-val" style={{ color }}>
        {value.toFixed(1)}
      </div>
      <div className="qb-gauge-lbl">{label}</div>
    </div>
  );
}
