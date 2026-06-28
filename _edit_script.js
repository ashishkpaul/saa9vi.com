const fs = require('fs');
let content = fs.readFileSync('/home/ashish/edu/saa9vi_com/docs/adr/rfc-001-continuous-commerce-loop.md', 'utf-8');

// Edit 6: Add INV-SUB-007 after INV-SUB-006
const target = 'Access continues until period end.';
const replacement = 'Access continues until period end.\n\n#### INV-SUB-007: SubscriptionPlan Soft-Delete Guard\n\nA `SubscriptionPlan` may not be hard-deleted if any `SubscriptionEnrollment` with status not in `{\'cancelled\', \'suspended\'}` references it. The `isActive = false` flag is the soft-delete mechanism. This invariant prevents orphaned enrollments from referencing a deleted plan.\n\nConstraint: `DELETE FROM subscription_plan WHERE id = :id AND NOT EXISTS (SELECT 1 FROM subscription_enrollment WHERE plan_id = :id AND status NOT IN (\'cancelled\', \'suspended\'))`.\n\nOn the application layer: `SubscriptionPlanService.delete()` checks this and throws `PlanHasActiveEnrollmentsError` if any active enrollments exist.';

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync('/home/ashish/edu/saa9vi_com/docs/adr/rfc-001-continuous-commerce-loop.md', content, 'utf-8');
  console.log('Edit 6 done.');
} else {
  console.log('Target not found');
}
