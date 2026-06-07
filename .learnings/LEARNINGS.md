# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## [LRN-20260607-001] correction

**Logged**: 2026-06-07T05:45:00+08:00
**Priority**: high

### Summary
When user references previously generated design images, use the exact user-provided artifact path first. Do not substitute nearby docs/assets boards with similar subject matter.

### Action
For overview UI work, use `/case/temp/k8s-aiops-manager/overview-ui-plan/image2/` dark/light dashboard mockups as hard constraints: same DOM/layout, theme changes via tokens only.
