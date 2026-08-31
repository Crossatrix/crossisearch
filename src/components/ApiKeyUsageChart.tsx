import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type UsageRow = { key_id: string; day: string; requests: number };
type KeyMeta = { id: string; label: string };

const SERIES_COLORS = [
  "hsl(var(--primary))",
  "hsl(200 90% 60%)",
  "hsl(150 70% 50%)",
  "hsl(330 80% 65%)",
  "hsl(280 70% 68%)",
];

export function ApiKeyUsageChart({
  keys,
  usage,
  days,
}: {
  keys: KeyMeta[];
  usage: UsageRow[];
  days: number;
}) {
  const { data, total } = useMemo(() => {
    const dayList: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dayList.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
    const byDay = new Map<string, Record<string, number | string>>();
    for (const d of dayList) {
      const row: Record<string, number | string> = { day: d.slice(5) };
      for (const k of keys) row[k.id] = 0;
      byDay.set(d, row);
    }
    let sum = 0;
    for (const u of usage) {
      const row = byDay.get(u.day);
      if (!row) continue;
      row[u.key_id] = (Number(row[u.key_id]) || 0) + u.requests;
      sum += u.requests;
    }
    return { data: Array.from(byDay.values()), total: sum };
  }, [keys, usage, days]);

  if (keys.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin keys yet.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {total} request{total === 1 ? "" : "s"} in the last {days} days.
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--secondary))", opacity: 0.4 }}
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                color: "hsl(var(--foreground))",
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                value,
                keys.find((k) => k.id === name)?.label ?? name,
              ]}
            />
            <Legend
              formatter={(value: string) => keys.find((k) => k.id === value)?.label ?? value}
              wrapperStyle={{ fontSize: 12 }}
            />
            {keys.map((k, i) => (
              <Bar
                key={k.id}
                dataKey={k.id}
                stackId="a"
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
