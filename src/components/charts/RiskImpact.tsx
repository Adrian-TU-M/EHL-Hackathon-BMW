import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";
import type { Requirement } from "../../lib/types";
export function RiskImpact({
  requirements,
  onSelect,
}: {
  requirements: Requirement[];
  onSelect: (r: Requirement) => void;
}) {
  const data = requirements.map((r, i) => ({
    ...r,
    x: r.risk,
    y: r.impact,
    index: i + 1,
  }));
  return (
    <div className="risk-chart">
      <ResponsiveContainer width="100%" height={270}>
        <ScatterChart margin={{ top: 22, right: 25, bottom: 25, left: 0 }}>
          <CartesianGrid stroke="#e8edf3" strokeDasharray="3 4" />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 5.5]}
            ticks={[1, 2, 3, 4, 5]}
            name="Risk"
            axisLine={false}
            tickLine={false}
            fontSize={11}
            label={{
              value: "RISK →",
              position: "bottom",
              offset: 5,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, 5.6]}
            ticks={[1, 2, 3, 4, 5]}
            name="Potential impact"
            axisLine={false}
            tickLine={false}
            width={32}
            fontSize={11}
          />
          <ReferenceLine x={2.5} stroke="#a9b8ca" strokeDasharray="5 5" />
          <ReferenceLine y={2.5} stroke="#a9b8ca" strokeDasharray="5 5" />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <strong>{payload[0].payload.id}</strong>
                  <span>{payload[0].payload.title}</span>
                  <small>
                    Impact {payload[0].payload.impact}/5 · Risk{" "}
                    {payload[0].payload.risk}/5 · Illustrative
                  </small>
                </div>
              ) : null
            }
          />
          <Scatter
            data={data}
            onClick={(d) => onSelect(d.payload as Requirement)}
          >
            {data.map((r) => (
              <Cell
                key={r.id}
                fill={r.status === "Approved" ? "#349779" : "#1c69d4"}
                fillOpacity={0.8}
              />
            ))}
            <LabelList
              dataKey="index"
              position="top"
              offset={7}
              fontSize={11}
              fill="#53647a"
            />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <span className="impact-axis">POTENTIAL CUSTOMER IMPACT ↑</span>
    </div>
  );
}
