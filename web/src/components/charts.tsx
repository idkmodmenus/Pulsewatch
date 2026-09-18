import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { shortTime } from '../lib/format';

const axis = { stroke: '#7C8C99', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: '#121820', border: '1px solid #1F2A35', borderRadius: 6, fontSize: 12 },
  labelStyle: { color: '#7C8C99' }
} as const;

export function LatencyChart({
  data,
  keys = [
    { key: 'avg_ms', label: 'Average', color: '#58C2C6' },
    { key: 'p95_ms', label: 'p95', color: '#D9A441' }
  ],
  height = 220
}: {
  data: any[];
  keys?: { key: string; label: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortTime} {...axis} minTickGap={32} />
        <YAxis unit=" ms" {...axis} width={62} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleString()} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: '#7C8C99' }} />
        {keys.map((k) => (
          <Line
            key={k.key}
            type="monotone"
            dataKey={k.key}
            name={k.label}
            stroke={k.color}
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PhaseChart({ data, height = 220 }: { data: any[]; height?: number }) {
  const phases = [
    { key: 'dns_ms', label: 'DNS', color: '#58C2C6' },
    { key: 'tcp_ms', label: 'TCP', color: '#57B894' },
    { key: 'tls_ms', label: 'TLS', color: '#D9A441' },
    { key: 'ttfb_ms', label: 'Waiting', color: '#7FA6C4' },
    { key: 'download_ms', label: 'Download', color: '#7C8C99' }
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortTime} {...axis} minTickGap={32} />
        <YAxis unit=" ms" {...axis} width={62} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleString()} />
        <Legend iconType="square" wrapperStyle={{ fontSize: 11, color: '#7C8C99' }} />
        {phases.map((p) => (
          <Area
            key={p.key}
            type="monotone"
            dataKey={p.key}
            name={p.label}
            stackId="phases"
            stroke={p.color}
            fill={p.color}
            fillOpacity={0.28}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function AvailabilityChart({ data, height = 140 }: { data: any[]; height?: number }) {
  const shaped = data.map((d) => ({
    ...d,
    uptime: d.checks ? ((d.checks - d.failures) / d.checks) * 100 : 100
  }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={shaped} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortTime} {...axis} minTickGap={32} />
        <YAxis domain={[90, 100]} unit="%" {...axis} width={62} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleString()} />
        <Bar dataKey="uptime" name="Availability" fill="#57B894" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ResourceChart({ data, height = 200 }: { data: any[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--grid-line)" vertical={false} />
        <XAxis dataKey="bucket" tickFormatter={shortTime} {...axis} minTickGap={32} />
        <YAxis domain={[0, 100]} unit="%" {...axis} width={52} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => new Date(v).toLocaleString()} />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 11, color: '#7C8C99' }} />
        <Line type="monotone" dataKey="cpu" name="CPU" stroke="#58C2C6" dot={false} strokeWidth={1.6} isAnimationActive={false} />
        <Line type="monotone" dataKey="memory" name="Memory" stroke="#D9A441" dot={false} strokeWidth={1.6} isAnimationActive={false} />
        <Line type="monotone" dataKey="disk" name="Disk" stroke="#7C8C99" dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
