import { describe, expect, it } from 'vitest';
import { buildRawMimeMessage, toBase64Url } from './mimeMessage.js';

function decodeHeaderValue(headerLine: string): string {
  const match = headerLine.match(/=\?UTF-8\?B\?(.+)\?=/);
  if (!match) throw new Error(`En-tête non encodé : ${headerLine}`);
  return Buffer.from(match[1], 'base64').toString('utf-8');
}

describe('buildRawMimeMessage', () => {
  it('inclut To, Subject (encodé) et un Content-Type multipart/mixed', () => {
    const raw = buildRawMimeMessage({ to: 'marie@example.com', cc: [], subject: 'Été 2026', htmlBody: '<p>Bonjour</p>', attachments: [] });

    expect(raw).toContain('To: marie@example.com');
    expect(raw).toMatch(/Content-Type: multipart\/mixed; boundary="[^"]+"/);

    const subjectLine = raw.split('\r\n').find((line) => line.startsWith('Subject:'));
    expect(subjectLine).toBeDefined();
    expect(decodeHeaderValue(subjectLine!)).toBe('Été 2026');
  });

  it("omet l'en-tête Cc quand la liste est vide", () => {
    const raw = buildRawMimeMessage({ to: 'a@example.com', cc: [], subject: 'x', htmlBody: '<p>x</p>', attachments: [] });
    expect(raw).not.toMatch(/^Cc:/m);
  });

  it('inclut Cc quand des adresses sont fournies', () => {
    const raw = buildRawMimeMessage({
      to: 'a@example.com',
      cc: ['b@example.com', 'c@example.com'],
      subject: 'x',
      htmlBody: '<p>x</p>',
      attachments: [],
    });
    expect(raw).toContain('Cc: b@example.com, c@example.com');
  });

  it('encode le corps HTML en base64, décodable', () => {
    const raw = buildRawMimeMessage({ to: 'a@example.com', cc: [], subject: 'x', htmlBody: '<p>Bonjour Marie</p>', attachments: [] });
    const [, bodyBase64Block] = raw.split('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n');
    const bodyBase64 = bodyBase64Block.split('\r\n--')[0].replace(/\r\n/g, '');
    expect(Buffer.from(bodyBase64, 'base64').toString('utf-8')).toBe('<p>Bonjour Marie</p>');
  });

  it('inclut une pièce jointe avec son Content-Type, son nom et son contenu décodable', () => {
    const content = Buffer.from('contenu du fichier').toString('base64');
    const raw = buildRawMimeMessage({
      to: 'a@example.com',
      cc: [],
      subject: 'x',
      htmlBody: '<p>x</p>',
      attachments: [{ filename: 'contrat.pdf', mimeType: 'application/pdf', contentBase64: content }],
    });

    expect(raw).toContain('Content-Type: application/pdf; name="contrat.pdf"');
    expect(raw).toContain('Content-Disposition: attachment; filename="contrat.pdf"');

    const attachmentBlock = raw.split('Content-Disposition: attachment; filename="contrat.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1];
    const attachmentBase64 = attachmentBlock.split('\r\n--')[0].replace(/\r\n/g, '');
    expect(Buffer.from(attachmentBase64, 'base64').toString('utf-8')).toBe('contenu du fichier');
  });

  it('découpe les lignes base64 à 76 caractères maximum (RFC 2045)', () => {
    const longBody = '<p>' + 'x'.repeat(300) + '</p>';
    const raw = buildRawMimeMessage({ to: 'a@example.com', cc: [], subject: 'x', htmlBody: longBody, attachments: [] });

    const lines = raw.split('\r\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });
});

describe('toBase64Url', () => {
  it("ne contient aucun caractère '+', '/' ou '=' de padding", () => {
    const encoded = toBase64Url('un contenu quelconque à encoder, avec des +/= potentiels'.repeat(3));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('se décode correctement en base64 standard une fois le padding restauré', () => {
    const original = 'Bonjour, ceci est un test.';
    const encoded = toBase64Url(original);
    const restoredBase64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = restoredBase64 + '='.repeat((4 - (restoredBase64.length % 4)) % 4);
    expect(Buffer.from(padded, 'base64').toString('utf-8')).toBe(original);
  });
});
