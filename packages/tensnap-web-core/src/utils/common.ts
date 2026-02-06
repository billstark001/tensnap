
export function generateUniqueId() {
  const timestamp = Date.now().toString(36).slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 12); // Shorter random part
  return `${randomPart}${timestamp}`;
}