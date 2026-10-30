// Inspect the single scalar emitted by the chart's platform ConfigMap.
export function agentVExampleFailures(rendered, expectedVersion, label) {
  const versions = [...rendered.matchAll(/^[ \t]*AGENTV_SYSTEMD_RELEASE_VERSION:[ \t]*([^\r\n]*)/gm)]
    .map((match) => match[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
  if (versions.length === 1 && versions[0] === expectedVersion) return [];
  return [
    `${label}: expected exactly one AGENTV_SYSTEMD_RELEASE_VERSION equal to ${expectedVersion}; got ${JSON.stringify(versions)}`
  ];
}
