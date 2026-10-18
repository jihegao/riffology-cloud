export function summarize(business) {
  const sections = business?.payload?.sections;
  if (!sections) return { unsupported: 'No aircraft Business payload' };
  return { aircraft: sections.aircraft?.collections.assets.map(a => ({ businessId: a.business_id, ...a.definition })),
    tasks: sections.mission_profile?.collections.composite_tasks.flatMap(t => t.definition.taskItems),
    missionRules: sections.mission_profile?.collections.basic_missions.map(m => ({ businessId: m.business_id, ...m.definition })),
    resources: sections.support_network?.collections.nodes.map(n => ({ businessId: n.business_id, ...n.definition })),
    support: sections.support_activities?.collections.activities.map(a => ({ businessId: a.business_id, ...a.definition })),
    durationMinutes: sections.time?.properties.duration_minutes, profile: business.payload.semantic_profile,
    assumptions: ['Synthetic deterministic daily support', 'Minute ticks, serial work, Plan phase ordering', 'Browser results are local/unverified'] };
}
