import fetch from 'node-fetch';

/**
 * Checks if a URL is alive by making a HEAD request
 * @param url The URL to check
 * @returns Promise<boolean> True if the URL is alive, false otherwise
 */
export async function isUrlAlive(url: string): Promise<boolean> {
  try {
    // Basic URL validation
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    // Check if the URL has a valid protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Try to make a HEAD request to check if the URL is alive
    // Use AbortController for timeout since fetch doesn't support timeout option directly
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
      }
    });
    
    // Clear the timeout to prevent memory leaks
    clearTimeout(timeoutId);
    
    return response.ok || response.status === 403; // Consider 403 Forbidden as "alive" since it means the server responded
  } catch (error) {
    console.log(`URL validation error for ${url}:`, error);
    return false;
  }
}

/**
 * Fallback URL generator for common educational platforms
 * @param topic The topic to generate fallback URLs for
 * @returns Record<string, string[]> A mapping of resource types to fallback URLs
 */
export function getFallbackUrls(topic: string): Record<string, string[]> {
  const encodedTopic = encodeURIComponent(topic);
  
  return {
    'course': [
      `https://www.coursera.org/search?query=${encodedTopic}`,
      `https://www.edx.org/search?q=${encodedTopic}`,
      `https://www.udemy.com/courses/search/?src=ukw&q=${encodedTopic}`
    ],
    'video': [
      `https://www.youtube.com/results?search_query=${encodedTopic}+tutorial`,
      `https://www.khanacademy.org/search?page_search_query=${encodedTopic}`
    ],
    'article': [
      `https://medium.com/search?q=${encodedTopic}`,
      `https://scholar.google.com/scholar?q=${encodedTopic}`
    ],
    'interactive': [
      `https://www.w3schools.com/search/search.asp?q=${encodedTopic}`,
      `https://www.codecademy.com/search?query=${encodedTopic}`
    ],
    'ebook': [
      `https://www.google.com/search?tbm=bks&q=${encodedTopic}`,
      `https://openlibrary.org/search?q=${encodedTopic}`
    ]
  };
}