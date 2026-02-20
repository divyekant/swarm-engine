import type { PersonaConfig } from '../../types.js';

/**
 * Extract content between XML-style tags from PersonaSmith Markdown.
 * Returns empty string if section not found.
 */
function extractSection(markdown: string, tagName: string): string {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const startIdx = markdown.indexOf(openTag);
  if (startIdx === -1) return '';
  const contentStart = startIdx + openTag.length;
  const endIdx = markdown.indexOf(closeTag, contentStart);
  if (endIdx === -1) return markdown.slice(contentStart).trim();
  return markdown.slice(contentStart, endIdx).trim();
}

/**
 * Extract a **Label:** Value field from a section.
 */
function extractField(section: string, label: string): string {
  const pattern = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, 'i');
  const match = section.match(pattern);
  return match ? match[1].trim() : '';
}

/**
 * Extract bulleted list items from a section, starting after a header line.
 * Returns all `- item` lines found after the header, stopping at the next header or end.
 */
function extractBulletList(section: string, afterHeader?: string): string[] {
  let text = section;
  if (afterHeader) {
    const headerPattern = new RegExp(`\\*\\*${afterHeader}:?\\*\\*`, 'i');
    const headerMatch = text.match(headerPattern);
    if (!headerMatch || headerMatch.index === undefined) return [];
    text = text.slice(headerMatch.index + headerMatch[0].length);
    // Stop at the next ** header
    const nextHeader = text.match(/\n\*\*[A-Z]/);
    if (nextHeader?.index !== undefined) {
      text = text.slice(0, nextHeader.index);
    }
  }

  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2).trim());
}

/**
 * Parse a PersonaSmith Markdown file into a PersonaConfig.
 *
 * Extracts structured metadata from XML-tagged sections while
 * preserving the full Markdown as `fullPrompt` for system prompt injection.
 */
export function parsePersonaMarkdown(markdown: string): PersonaConfig {
  const identity = extractSection(markdown, 'identity');
  const commStyle = extractSection(markdown, 'communication_style');
  const constraintsSection = extractSection(markdown, 'constraints_and_rules');
  const collabMap = extractSection(markdown, 'collaboration_map');

  // Identity fields
  const name = extractField(identity, 'Title');
  const department = extractField(identity, 'Department') || undefined;
  const seniority = extractField(identity, 'Seniority Level') || undefined;
  const expertiseDomain = extractField(identity, 'Expertise Domain');

  // Role: use the first paragraph after the structured fields in identity
  const identityLines = identity.split('\n');
  const roleLines = identityLines.filter(
    line => line.trim() !== '' && !line.trim().startsWith('**') && !line.trim().startsWith('#')
  );
  const role = roleLines.join(' ').trim() || name;

  // Expertise: split comma-separated domain
  const expertise = expertiseDomain
    ? expertiseDomain.split(',').map(e => e.trim()).filter(Boolean)
    : [];

  // Communication style
  const tone = extractField(commStyle, 'Tone');
  const traits = tone
    ? tone.split(/,|\band\b/).map(t => t.trim()).filter(Boolean)
    : [];
  const communicationStyle = extractField(commStyle, 'Formality Level') || undefined;

  // Constraints: combine "Hard Rules" and "You Must Never" bullet lists
  const hardRules = extractBulletList(constraintsSection, 'Hard Rules');
  const mustNever = extractBulletList(constraintsSection, 'You Must Never');
  const constraints = [...hardRules, ...mustNever];

  // Collaboration map: raw content for programmatic use
  const collaborationMap = collabMap || undefined;

  return {
    name,
    role,
    traits,
    constraints,
    communicationStyle,
    expertise,
    fullPrompt: markdown,
    department,
    seniority,
    collaborationMap,
  };
}
