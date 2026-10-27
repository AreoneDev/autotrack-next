import {
    Activity,
    CalendarCheck,
    CheckCircle2,
    CircleDollarSign,
    Gauge,
    MessageSquareReply,
    TrendingUp,
    Users,
} from "lucide-react";

import {
    AnalyticsNumberMetric,
    AnalyticsRatioMetric,
    AnalyticsService,
    HotLeadsTrendPoint,
    SalesClosingRateTrendPoint,
} from "@/domain/business/AnalyticsService";
import { ScoringService } from "@/domain/business/ScoringService";
import { LeadRepo } from "@/lib/persistence/real/supabase/LeadRepo";
import { requireServerClient } from "@/lib/supabase/server";
import { NotificationRepo } from "@/lib/persistence/real/supabase/NotificationRepo";
import { TaskRepo } from "@/lib/persistence/real/supabase/TaskRepo";

const sectionConfig = [
    {
        title: "Conversion Performance",
        description: "How effectively leads move into appointments and deliveries.",
        icon: TrendingUp,
    },
    {
        title: "Lead Quality",
        description: "Current pipeline health and high-intent opportunity mix.",
        icon: Gauge,
    },
    {
        title: "Performance Trends",
        description: "Monthly changes in closing rate and hot lead generation.",
        icon: Activity,
    },
    {
        title: "Communication Effectiveness",
        description: "Customer engagement, two-way conversations, and follow-up discipline.",
        icon: MessageSquareReply,
    },
    {
        title: "Revenue Insights",
        description: "Budget quality and margin-related delivery indicators.",
        icon: CircleDollarSign,
    },
];

function formatPercent(value: number): string {
    return `${value}%`;
}

function formatNumber(value: number): string {
    return new Intl.NumberFormat("en-CA", {
        maximumFractionDigits: 1,
    }).format(value);
}

function RatioCard({ metric }: { metric: AnalyticsRatioMetric }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-medium text-slate-500">
                        {metric.label}
                    </p>
                    <h3 className="mt-2 text-3xl font-bold text-slate-950">
                        {formatPercent(metric.percentage)}
                    </h3>
                </div>

                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                    {metric.numerator}/{metric.denominator}
                </span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${metric.percentage}%` }}
                />
            </div>

            <p className="mt-3 text-sm text-slate-500">
                {metric.description}
            </p>

            {metric.note ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {metric.note}
                </p>
            ) : null}
        </div>
    );
}

function NumberCard({ metric }: { metric: AnalyticsNumberMetric }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">
                {metric.label}
            </p>
            <h3 className="mt-2 text-3xl font-bold text-slate-950">
                {formatNumber(metric.value)}
            </h3>
            <p className="mt-3 text-sm text-slate-500">
                {metric.description}
            </p>

            {metric.note ? (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {metric.note}
                </p>
            ) : null}
        </div>
    );
}

function SectionHeader({
    title,
    description,
    icon: Icon,
}: {
    title: string;
    description: string;
    icon: typeof Activity;
}) {
    return (
        <div className="mb-5 flex items-center justify-between gap-4">
            <div>
                <h2 className="text-lg font-bold text-slate-950">
                    {title}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                    {description}
                </p>
            </div>
            <Icon className="shrink-0 text-blue-600" size={22} />
        </div>
    );
}

function getChartPoints(values: number[]) {
    const width = 520;
    const height = 220;
    const paddingX = 38;
    const paddingY = 30;
    const maxValue = Math.max(...values, 1);
    const stepX =
        values.length <= 1
            ? 0
            : (width - paddingX * 2) / (values.length - 1);

    return values.map((value, index) => {
        const x = paddingX + index * stepX;
        const y =
            height -
            paddingY -
            (value / maxValue) * (height - paddingY * 2);

        return { x, y };
    });
}

function LineChartCard({
    title,
    description,
    data,
    valueSuffix = "",
}: {
    title: string;
    description: string;
    data: Array<{
        period: string;
        value: number;
    }>;
    valueSuffix?: string;
}) {
    const chartWidth = 520;
    const chartHeight = 220;

    if (data.length < 2) {
        return (
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-slate-950">
                    {title}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                    {description}
                </p>
                <div className="mt-5 flex min-h-[220px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">
                    Not enough data to display trend yet.
                </div>
            </div>
        );
    }

    const values = data.map((point) => point.value);
    const chartPoints = getChartPoints(values);
    const polylinePoints = chartPoints
        .map((point) => `${point.x},${point.y}`)
        .join(" ");
    const maxValue = Math.max(...values, 1);

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-semibold text-slate-950">
                {title}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
                {description}
            </p>

            <div className="mt-5 overflow-x-auto">
                <svg
                    role="img"
                    aria-label={title}
                    viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                    className="h-[240px] min-w-[420px] rounded-lg bg-slate-50"
                >
                    <line
                        x1="38"
                        y1="30"
                        x2="38"
                        y2="190"
                        stroke="#cbd5e1"
                        strokeWidth="1"
                    />
                    <line
                        x1="38"
                        y1="190"
                        x2="482"
                        y2="190"
                        stroke="#cbd5e1"
                        strokeWidth="1"
                    />

                    <text
                        x="12"
                        y="35"
                        className="fill-slate-500 text-[11px]"
                    >
                        {maxValue}
                        {valueSuffix}
                    </text>
                    <text
                        x="20"
                        y="193"
                        className="fill-slate-500 text-[11px]"
                    >
                        0
                    </text>

                    <polyline
                        points={polylinePoints}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="3"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                    />

                    {chartPoints.map((point, index) => (
                        <g key={`${data[index].period}-${data[index].value}`}>
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r="4"
                                fill="#2563eb"
                            >
                                <title>
                                    {data[index].period}: {data[index].value}
                                    {valueSuffix}
                                </title>
                            </circle>
                            <text
                                x={point.x}
                                y="210"
                                textAnchor="middle"
                                className="fill-slate-500 text-[10px]"
                            >
                                {data[index].period}
                            </text>
                        </g>
                    ))}
                </svg>
            </div>
        </div>
    );
}

function mapClosingTrend(data: SalesClosingRateTrendPoint[]) {
    return data.map((point) => ({
        period: point.period,
        value: point.rate,
    }));
}

function mapHotLeadsTrend(data: HotLeadsTrendPoint[]) {
    return data.map((point) => ({
        period: point.period,
        value: point.count,
    }));
}

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
    const client = await requireServerClient();
    const leadRepository = new LeadRepo(client);
    const taskRepository = new TaskRepo(client);
    const notificationRepository = new NotificationRepo(client);
    const analyticsService = new AnalyticsService(new ScoringService());

    const [leads, tasks, notifications] = await Promise.all([
        leadRepository.getAllLeads(),
        taskRepository.getAllTasks(),
        notificationRepository.getAllNotifications(),
    ]);

    const summary = analyticsService.getAnalyticsSummary(
        leads,
        tasks,
        notifications
    );
    const [
        conversionConfig,
        qualityConfig,
        trendsConfig,
        communicationConfig,
        revenueConfig,
    ] = sectionConfig;

    return (
        <main className="space-y-6 text-slate-900">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader {...trendsConfig} />
                <div className="grid gap-4 lg:grid-cols-2">
                    <LineChartCard
                        title="Sales Closing Rate Trend"
                        description="Shows how many leads are turning into vehicle deliveries over time."
                        data={mapClosingTrend(summary.salesClosingRateTrend)}
                        valueSuffix="%"
                    />
                    <LineChartCard
                        title="Hot Leads Trend"
                        description="Shows how many high-priority leads are being generated over time."
                        data={mapHotLeadsTrend(summary.hotLeadsTrend)}
                    />
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader {...conversionConfig} />
                <div className="grid gap-4 md:grid-cols-2">
                    <RatioCard
                        metric={
                            summary.conversionPerformance
                                .leadAppointmentRatio
                        }
                    />
                    <RatioCard
                        metric={
                            summary.conversionPerformance.leadDeliveryRatio
                        }
                    />
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader {...qualityConfig} />
                <div className="grid gap-4 md:grid-cols-2">
                    <RatioCard metric={summary.leadQuality.activeLeadRatio} />
                    <RatioCard metric={summary.leadQuality.hotLeadRatio} />
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader {...communicationConfig} />
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <RatioCard
                        metric={
                            summary.communicationEffectiveness
                                .engagementRatio
                        }
                    />
                    <RatioCard
                        metric={
                            summary.communicationEffectiveness
                                .twoWayCommunicationRatio
                        }
                    />
                    <RatioCard
                        metric={
                            summary.communicationEffectiveness
                                .followUpCompletionRatio
                        }
                    />
                    <RatioCard
                        metric={
                            summary.communicationEffectiveness
                                .onTimeFollowUpRatio
                        }
                    />
                    <NumberCard
                        metric={
                            summary.communicationEffectiveness
                                .averageTouchpointsPerLead
                        }
                    />
                </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <SectionHeader {...revenueConfig} />
                <div className="grid gap-4 md:grid-cols-2">
                    <RatioCard
                        metric={summary.revenueInsights.highValueLeadRatio}
                    />
                    <RatioCard
                        metric={summary.revenueInsights.budgetThresholdRatio}
                    />
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <Users size={22} />
                    </div>
                    <p className="text-sm font-medium text-slate-500">
                        Data Source
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        Calculated from real Leads, Tasks, and Notifications repositories.
                    </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <CalendarCheck size={22} />
                    </div>
                    <p className="text-sm font-medium text-slate-500">
                        Appointment Detection
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        Appointment ratios use appointment-related task and notification records.
                    </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        <CheckCircle2 size={22} />
                    </div>
                    <p className="text-sm font-medium text-slate-500">
                        Extensible Summary
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                        New metrics can be added to AnalyticsSummary without changing repository boundaries.
                    </p>
                </div>
            </section>
        </main>
    );
}
