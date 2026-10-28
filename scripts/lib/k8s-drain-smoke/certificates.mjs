import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createCertificates(namespace, serviceName, temporaryRoot = tmpdir()) {
  const directory = mkdtempSync(join(temporaryRoot, 'acornops-drain-tls-'));
  const file = (name) => join(directory, name);
  const openssl = (...args) => execFileSync('openssl', args, { stdio: 'pipe', timeout: 30000 });
  const read = (name) => readFileSync(file(name), 'utf8');
  try {
    openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=drain-ca',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      '-keyout', file('ca.key'), '-out', file('ca.crt'));
    const material = { 'ca.crt': read('ca.crt') }, certificates = {};
    const roles = [['controlPlane', 'control-plane'], ['executionEngine', 'execution-engine'], ['llmGateway', 'llm-gateway']];
    for (const [role, component] of roles) {
      const service = serviceName(component), certKey = `${component}.crt`, keyKey = `${component}.key`;
      const hosts = [service, `${service}.${namespace}`, `${service}.${namespace}.svc`,
        `${service}.${namespace}.svc.cluster.local`];
      writeFileSync(file('leaf.ext'), ['basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment', 'extendedKeyUsage=serverAuth,clientAuth',
        `subjectAltName=${hosts.map((dns) => `DNS:${dns}`).join(',')}`, ''].join('\n'), { mode: 0o600 });
      openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${component}`,
        '-keyout', file(keyKey), '-out', file('leaf.csr'));
      openssl('x509', '-req', '-in', file('leaf.csr'), '-CA', file('ca.crt'), '-CAkey', file('ca.key'),
        '-CAcreateserial', '-days', '1', '-extfile', file('leaf.ext'), '-out', file(certKey));
      material[certKey] = read(certKey);
      material[keyKey] = read(keyKey);
      certificates[role] = { secretName: `${namespace}-internal-tls`, certKey, keyKey };
    }
    return { material, redactions: [...Object.values(material), read('ca.key')],
      values: { enabled: true, requireClientCert: true, ca: { secretName: `${namespace}-internal-tls`, key: 'ca.crt' },
        certificates } };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
