/**
 * Construction d'un message MIME brut (RFC 2822/2045) pour l'API Gmail — logique pure,
 * sans appel réseau. Gmail n'offre pas d'API haut niveau pour composer un message avec
 * pièces jointes : il faut fournir le message complet encodé en base64url via `raw`.
 */

export type MimeAttachment = { filename: string; mimeType: string; contentBase64: string };

export type MimeMessageInput = {
  to: string;
  cc: string[];
  subject: string;
  htmlBody: string;
  attachments: MimeAttachment[];
};

function encodeHeaderValue(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/** RFC 2045 : lignes encodées en base64 limitées à 76 caractères. */
function wrapBase64(base64: string): string {
  return base64.replace(/.{1,76}/g, (line) => `${line}\r\n`).trimEnd();
}

export function buildRawMimeMessage(input: MimeMessageInput): string {
  const boundary = `mmmerge_${Math.random().toString(36).slice(2)}`;

  const headers = [
    `To: ${input.to}`,
    ...(input.cc.length > 0 ? [`Cc: ${input.cc.join(', ')}`] : []),
    `Subject: ${encodeHeaderValue(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];

  const bodyPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(input.htmlBody, 'utf-8').toString('base64')),
  ].join('\r\n');

  const attachmentParts = input.attachments.map((attachment) =>
    [
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(attachment.contentBase64),
    ].join('\r\n'),
  );

  return [headers.join('\r\n'), '', bodyPart, ...attachmentParts, `--${boundary}--`].join('\r\n');
}

/** Gmail exige le base64url (RFC 4648 §5), sans padding. */
export function toBase64Url(raw: string): string {
  return Buffer.from(raw, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
