# Product

## Register

product

## Users

KubeNova serves platform administrators, SREs, operations engineers, and delivery teams working in Kubernetes multi-cluster environments.

Platform administrators manage cluster onboarding, users, RBAC, platform updates, capability visibility, and audit posture.

SRE and operations users investigate workloads, networking, storage, runtime logs, terminals, incidents, topology relationships, and remediation actions.

Delivery teams work inside approved clusters and namespaces to inspect applications, validate release state, and complete routine changes without dropping into raw CLI workflows.

## Product Purpose

KubeNova is an enterprise Kubernetes AI operations control plane. It unifies multi-cluster resource management, topology, observability, runtime access, AI-assisted diagnosis, approval-aware recommendations, and platform governance in one authenticated console.

The product should not become a collection of duplicated resource pages. New capabilities must extend existing domains as tabs, modes, panels, or workbench views unless they represent a genuinely cross-domain workflow. Cross-domain workflows belong in existing first-class surfaces such as Overview, Resource Topology, Observability, AIOps, AI Assistant, Security, or System Management.

Success means an operator can move from signal to context to action quickly: detect risk, understand affected resources, inspect live state, ask AI for structured analysis, preview remediation, and leave an auditable trail.

## Brand Personality

Calm, technical, authoritative.

The interface should feel like a serious enterprise operations cockpit: modern, glass-influenced, high-density, and precise. It may use subtle halo and signal effects to show live focus, topology emphasis, incident severity, and AI analysis, but those effects must support task comprehension rather than decoration.

The voice should be concise, operational, and trustworthy. Labels should describe platform state and user action directly.

## Anti-references

Do not make KubeNova look like a generic AI SaaS template with purple gradients, oversized hero sections, floating marketing cards, vague copy, or decorative glow.

Do not duplicate existing functionality under new names. For example, incidents belong in AIOps unless a separate incident management workflow is fully justified; tracing belongs in Observability; compliance belongs with Security or Inspection; automation belongs with AIOps recommendations and System Management until it becomes a separate audited workflow.

Do not overuse glassmorphism. Frosted glass is allowed for shell chrome, overlays, command surfaces, topology inspectors, AI panels, and live-focus states. Resource tables, forms, and dense operational content must remain readable first.

Do not use motion that does not communicate state. No page-load choreography, rotating decorative elements, or animated backgrounds that compete with data.

Do not break black and white theme parity. Dark and light themes must expose the same information hierarchy, states, contrast, spacing, and interaction behavior.

## Design Principles

1. Signal before surface. Incident state, cluster health, topology focus, and live connection status deserve visual emphasis before decorative polish.
2. One capability, one home. Extend existing domains before adding new routes; avoid duplicate pages with different labels but the same job.
3. High density, low confusion. Tables, filters, drawers, and workbenches should be compact, but the action path must stay obvious.
4. AI inside the workflow. AI is a contextual operations layer, not a separate novelty surface. It should explain, correlate, recommend, preview, and audit.
5. Theme parity is a contract. Dark and light themes are both production themes; neither can be treated as a secondary skin.

## Accessibility & Inclusion

Target WCAG 2.1 AA for product UI surfaces.

All icon-only controls need accessible names. Keyboard access must work for sidebar navigation, command/search, filters, tables, row actions, drawers, modals, topology controls, terminal/log controls, and AI composer actions.

Reduced motion must be supported. Halo, scan, streaming, and focus effects should pause or simplify when `prefers-reduced-motion: reduce` is active.

Color cannot be the only state channel. Severity, health, pending, warning, critical, degraded, disabled, and selected states must use text, icon, shape, or position in addition to color.

