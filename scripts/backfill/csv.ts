/**
 * Parses CSV with quoted commas, escaped quotes, and line breaks, trimming fields and skipping empty rows.
 * Throws if a quoted field is unterminated.
 */
export function parseCsv(content: string): string[][] {
  const normalizedContent = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < normalizedContent.length; i++) {
    const char = normalizedContent[i];

    if (char === '"') {
      if (inQuotes && normalizedContent[i + 1] === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && normalizedContent[i + 1] === "\n") {
        i++;
      }
      currentRow.push(currentField.trim());
      currentField = "";

      // Only push non-empty rows
      if (currentRow.some((field) => field.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (inQuotes) {
    throw new Error("Unterminated quoted field in CSV input");
  }

  // Handle trailing field without final newline
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((field) => field.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}
