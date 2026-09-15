# Log query foundation

`POST /api/log-center/query` uses the existing bearer session guard. It temporarily
requires a platform administrator (including the existing `admin` alias) and a
live, accessible cluster. This is a fail-closed initial gate, not namespace RBAC.

Body: `clusterId`, `dataSourceId`, `from`, `to`, optional `namespace`, `keyword`,
and `limit` (default 100). Timestamps must be ISO 8601 with a timezone, with a
positive range no longer than 24 hours. Limit is an integer from 1 to 200;
keyword is at most 512 characters. Unknown properties are rejected.

The selected administrator-managed MonitoringDataSource must have the exact
cluster and source IDs, kind `elasticsearch`, and `enabled: true`. No client
endpoint, DSL, index, or field overrides are accepted. Required metadata:

```json
{
  "logQuery": {
    "indexPattern": "logs-*",
    "clusterField": "kubenova.cluster_id",
    "namespaceField": "kubernetes.namespace_name",
    "timestampField": "@timestamp",
    "messageField": "message"
  }
}
```

`indexPattern` is required: a lowercase alphanumeric prefix, followed by
lowercase alphanumerics, underscores or hyphens, optionally ending in one `*`.
The four field settings default to the values above. Fields use conservative
dotted names, with an optional leading `@`. Cluster and namespace fields must
be mapped for exact Elasticsearch term matching. Every query includes the
explicit cluster ID term filter. Pod/container output uses the fixed fields
`kubernetes.pod_name` and `kubernetes.container_name`.

Set `secretRef` to `env:ELASTICSEARCH_LOG_API_KEY` and provide that environment
variable to the API process. Its value is the encoded Elasticsearch API key,
sent as `Authorization: ApiKey ...`. No literal secrets, anonymous access,
other reference schemes, URL credentials, redirects, query strings, or URL
fragments are accepted. HTTP(S) endpoints are trusted administrator settings;
use HTTPS and an Elasticsearch key restricted to the intended indices.

Queries have a 5-second transport deadline, a 4-second Elasticsearch query
timeout, and a 2 MiB response body cap. Partial results (timeout or shard
failure), malformed results and oversized results fail with a sanitized 502.
Invalid input returns 400, unavailable/mismatched source 404, invalid source
configuration 503. No upstream error bodies or credentials are returned.

Success returns `{ "rows": [...] }` inside the application's existing response
envelope. Rows contain only `id`, `timestamp`, `namespace`, `pod`, `container`,
`message`. Text identifiers are capped at 256 characters and messages at 8192.
Empty results are real empty arrays; this module does not synthesize records.
There are no migrations, writes, collection lifecycle, pagination, or changes
to existing Pod log routes.
