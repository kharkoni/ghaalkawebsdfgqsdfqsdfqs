// Enhanced Website Source Downloader - Alqulol Team
let downloadedFiles = [];
let totalSize = 0;
let abortController = null;
let visitedUrls = new Set();
let crawledPages = [];
let baseUrl = '';
let baseDomain = '';

// Progress tracking
let totalExpectedFiles = 0;
let processedFiles = 0;

async function downloadWebsite() {
    const url = document.getElementById('urlInput').value.trim();

    // Enhanced URL validation
    if (!url) {
        showError('Please enter a website URL');
        return;
    }

    // Advanced URL validation
    const validationResult = validateAndNormalizeUrl(url);
    if (!validationResult.isValid) {
        showError(validationResult.error);
        return;
    }

    const normalizedUrl = validationResult.url;
    baseUrl = normalizedUrl;
    baseDomain = validationResult.hostname;

    // Check if trying to steal alqulol.xyz
    if (baseDomain.includes('alqulol.xyz') || baseDomain.includes('alqulol')) {
        await showAlquLolWarning();
        return;
    }

    // Skip reachability test - will handle errors during actual download

    // Reset state
    downloadedFiles = [];
    totalSize = 0;
    visitedUrls.clear();
    crawledPages = [];
    totalExpectedFiles = 0;
    processedFiles = 0;

    // Show status panel
    showStatus();

    // Create abort controller for cancelling
    abortController = new AbortController();
    const signal = abortController.signal;

    // Disable button and show spinner
    const downloadBtn = document.getElementById('downloadBtn');
    const btnText = document.getElementById('btnText');
    const spinner = document.getElementById('spinner');

    downloadBtn.disabled = true;
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        // Initialize progress bar
        initializeProgressBar();
        updateProgress(1, 'Starting website extraction...');

        // Start crawling from main page
        updateProgress(10, 'Loading main page...');
        await crawlWebsite(normalizedUrl, signal, 0, 3); // Max depth of 3 levels

        updateProgress(85, 'Processing downloaded files...');
        
        // Create ZIP file
        const zipBlob = await createZipArchive();
        updateProgress(95, 'Creating ZIP archive...');

        // Show download section
        showDownloadSection(zipBlob);
        updateProgress(100, 'Fully Website Done!');
        showProgressComplete();

        updateStatus(`🎉 Website successfully stolen! ${crawledPages.length} pages extracted. Ready for download!`, 'success');

    } catch (error) {
        if (error.name === 'AbortError') {
            updateStatus('❌ Download cancelled by user.', 'error');
        } else {
            console.error('Download error:', error);
            showError(`Failed to download website: ${getErrorMessage(error)}`);
        }
    } finally {
        // Reset button state
        downloadBtn.disabled = false;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        abortController = null;
    }
}

// Function to crawl website pages
async function crawlWebsite(startUrl, signal, currentDepth = 0, maxDepth = 3) {
    if (currentDepth > maxDepth || visitedUrls.has(startUrl)) {
        return;
    }

    visitedUrls.add(startUrl);
    
    try {
        // Update initial progress
        updateCrawlProgress(`Crawling page ${crawledPages.length + 1}...`);
        
        // Download the page content
        const content = await fetchWebsiteContent(startUrl, signal);

        if (!isValidContent(content, startUrl)) {
            console.warn(`Invalid content for ${startUrl}`);
            return;
        }

        // Process HTML content to fix relative URLs
        const processedContent = content.includes('<html') || content.includes('<HTML') ?
            processHTML(content, startUrl) : content;

        // Save the processed page
        const fileName = getFileNameFromUrl(startUrl);
        const mimeType = getMimeType(fileName);
        addFile(fileName, processedContent, mimeType);
        crawledPages.push(startUrl);
        processedFiles++;
        
        // Update progress after saving page
        updateCrawlProgress(`Downloaded ${crawledPages.length} page${crawledPages.length === 1 ? '' : 's'}...`);

        // Extract and download ALL resources for this page
        const resources = extractResources(content, startUrl);
        updateStatus('🔄 Processing...', 'info');

        // Download resources in batches to avoid overwhelming
        const batchSize = 5;
        for (let i = 0; i < resources.length; i += batchSize) {
            const batch = resources.slice(i, i + batchSize);
            await Promise.allSettled(
                batch.map(async (resource) => {
                    if (!visitedUrls.has(resource.url)) {
                        await downloadResource(resource.url, signal);
                    }
                })
            );

            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Extract links for further crawling
        if (currentDepth < maxDepth) {
            const links = extractLinks(content, startUrl);

            // Limit concurrent crawling to prevent overwhelming
            const batchSize = 2;
            for (let i = 0; i < links.length; i += batchSize) {
                const batch = links.slice(i, i + batchSize);
                await Promise.allSettled(
                    batch.map(link => crawlWebsite(link, signal, currentDepth + 1, maxDepth))
                );
            }
        }

    } catch (error) {
        console.warn(`Failed to crawl ${startUrl}:`, error);
    }
}

// Function to download individual resources
async function downloadResource(url, signal) {
    if (visitedUrls.has(url)) return;

    visitedUrls.add(url);

    try {
        const fileName = getFileNameFromUrl(url);
        updateStatus('🔄 Loading...', 'info');

        const mimeType = getMimeType(fileName);

        // Determine if this should be downloaded as binary
        const isBinary = mimeType.startsWith('image/') ||
                        mimeType.startsWith('video/') ||
                        mimeType.startsWith('audio/') ||
                        mimeType.includes('font') ||
                        fileName.match(/\.(woff|woff2|ttf|eot|otf|png|jpg|jpeg|gif|svg|ico|webp|bmp|pdf|zip|exe|dmg|mp4|avi|mov|webm|mp3|wav|flac)$/i);

        let content;
        if (isBinary) {
            // Use specialized binary download method
            content = await fetchBinaryResource(url, signal);
        } else {
            // Use text download method
            content = await fetchWebsiteContent(url, signal);
        }

        if (content) {
            addFile(fileName, content, mimeType);
            processedFiles++;
        } else {
            // Create placeholder file if download fails
            const placeholder = `<!-- Failed to download: ${url} -->`;
            addFile(fileName, placeholder, 'text/plain');
            processedFiles++;
        }
    } catch (error) {
        console.warn(`Failed to download resource ${url}:`, error);
        // Create placeholder instead of failing completely
        try {
            const fileName = getFileNameFromUrl(url);
            const placeholder = `<!-- Failed to download: ${url} - ${error.message} -->`;
            addFile(fileName, placeholder, 'text/plain');
            processedFiles++;
        } catch (e) {
            updateStatus('🔄 Processing...', 'info');
        }
    }
}

// Specialized function for downloading binary resources
async function fetchBinaryResource(url, signal, attempt = 0) {
    const timeout = 20000;
    const MAX_ATTEMPTS = 4;

    const fetchMethods = [
        // Method 1: Direct fetch
        async () => {
            const response = await fetchWithTimeout(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                    'Referer': baseUrl,
                    'Origin': baseUrl
                },
                mode: 'cors',
                signal
            }, timeout);
            if (response.ok) return await response.arrayBuffer();
            throw new Error(`Direct fetch failed: ${response.status}`);
        },

        // Method 2: CORS proxy
        async () => {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*'
                },
                signal
            }, timeout);
            if (response.ok) return await response.arrayBuffer();
            throw new Error(`CORS proxy failed: ${response.status}`);
        },

        // Method 3: Alternative proxy
        async () => {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal
            }, timeout);
            if (response.ok) return await response.arrayBuffer();
            throw new Error(`Alternative proxy failed: ${response.status}`);
        },

        // Method 4: Try with no-cors mode
        async () => {
            const response = await fetchWithTimeout(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                mode: 'no-cors',
                signal
            }, timeout);
            // Note: no-cors doesn't allow reading response, but we try anyway
            if (response.type === 'opaque') {
                // Can't read opaque response, return null to trigger placeholder
                return null;
            }
            return await response.arrayBuffer();
        }
    ];

    // Try each method
    for (let i = 0; i < fetchMethods.length; i++) {
        try {
            const result = await fetchMethods[i]();
            if (result && result.byteLength > 0) {
                return result;
            }
        } catch (error) {
            console.warn(`Binary fetch method ${i + 1} failed for ${url}:`, error.message);
            if (i < fetchMethods.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }

    // Return null instead of throwing to allow placeholder creation
    return null;
}

function isValidURL(string) {
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

async function fetchWebsiteContent(url, signal, asBinary = false) {
    const timeout = 45000; // Increased timeout

    // Enhanced user agents
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
    ];

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    // Multiple bypass methods
    const bypassMethods = [
        // Method 1: AllOrigins (most reliable)
        async () => {
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': randomUA,
                    'Accept': 'application/json'
                },
                signal
            }, 20000);

            if (!response.ok) throw new Error(`AllOrigins failed: ${response.status}`);
            const data = await response.json();
            return data.contents;
        },

        // Method 2: JSONProxy
        async () => {
            const proxyUrl = `https://jsonp.afeld.me/?url=${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': randomUA,
                    'Accept': 'text/html'
                },
                signal
            }, 20000);

            if (!response.ok) throw new Error(`JSONProxy failed: ${response.status}`);
            return await response.text();
        },

        // Method 3: CORS Proxy
        async () => {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': randomUA,
                    'Origin': 'https://corsproxy.io'
                },
                signal
            }, 20000);

            if (!response.ok) throw new Error(`CORS proxy failed: ${response.status}`);
            return await response.text();
        },

        // Method 4: CodeTabs
        async () => {
            const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': randomUA,
                    'Accept': 'text/html'
                },
                signal
            }, 20000);

            if (!response.ok) throw new Error(`CodeTabs failed: ${response.status}`);
            return await response.text();
        },

        // Method 5: ThingProxy
        async () => {
            const proxyUrl = `https://thingproxy.freeboard.io/fetch/${url}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': randomUA,
                    'Referer': 'https://thingproxy.freeboard.io/'
                },
                signal
            }, 20000);

            if (!response.ok) throw new Error(`ThingProxy failed: ${response.status}`);
            return await response.text();
        },

        // Method 6: Direct fetch with enhanced headers
        async () => {
            const response = await fetchWithTimeout(url, {
                headers: {
                    'User-Agent': randomUA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                mode: 'cors',
                signal
            }, 15000);

            if (!response.ok) throw new Error(`Direct fetch failed: ${response.status}`);
            return await response.text();
        }
    ];

    // Simple loading message
    const messageInterval = setInterval(() => {
        if (!signal.aborted) {
            updateStatus('🔄 Loading...', 'info');
        }
    }, 2000);

    // Try each method
    for (let i = 0; i < bypassMethods.length; i++) {
        try {
            if (signal.aborted) throw new Error('Download cancelled');

            const content = await bypassMethods[i]();

            if (isValidContent(content, url)) {
                clearInterval(messageInterval);
                updateStatus('🔄 Processing...', 'info');
                return asBinary ? await fetch(url, { signal }).then(res => res.arrayBuffer()) : content;
            } else {
                console.warn(`Method ${i + 1} returned invalid content`);
                continue;
            }

        } catch (error) {
            if (error.name === 'AbortError' || signal.aborted) {
                clearInterval(messageInterval);
                throw new Error('Download cancelled');
            }
            console.warn(`Method ${i + 1} failed:`, error.message);

            // Add delay between attempts
            if (i < bypassMethods.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    clearInterval(messageInterval);

    throw new Error('Unable to access website - please check the URL and try again');
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out');
        }
        throw error;
    }
}

function isValidContent(content, url) {
    if (!content || content.length < 50) return false;

    const lowerContent = content.toLowerCase();

    // Check for valid HTML first
    const hasValidHTML = lowerContent.includes('<html') ||
        lowerContent.includes('<!doctype') ||
        lowerContent.includes('<head') ||
        lowerContent.includes('<body') ||
        lowerContent.includes('<div') ||
        lowerContent.includes('<title');

    // If no HTML found, it's likely not a webpage
    if (!hasValidHTML) return false;

    // Only flag as protected if we see MULTIPLE protection indicators together
    const strongProtectionIndicators = [
        'checking your browser',
        'just a moment',
        'enable javascript and cookies',
        'ddos protection by cloudflare',
        'bot protection activated'
    ];

    const protectionCount = strongProtectionIndicators.filter(indicator =>
        lowerContent.includes(indicator)
    ).length;

    // Only reject if multiple strong indicators are present
    if (protectionCount >= 2) return false;

    // Additional check: if content is suspiciously short and contains protection words
    if (content.length < 500) {
        const suspiciousWords = ['cloudflare', 'checking', 'moment', 'browser'];
        const suspiciousCount = suspiciousWords.filter(word =>
            lowerContent.includes(word)
        ).length;

        if (suspiciousCount >= 3) return false;
    }

    return true;
}

function processHTML(htmlContent, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Convert relative URLs to absolute and download resources
    const elements = [
        { selector: 'link[href]', attr: 'href' },
        { selector: 'script[src]', attr: 'src' },
        { selector: 'img[src]', attr: 'src' },
        { selector: 'img[data-src]', attr: 'data-src' },
        { selector: 'source[src]', attr: 'src' },
        { selector: 'source[srcset]', attr: 'srcset' },
        { selector: 'video[src]', attr: 'src' },
        { selector: 'audio[src]', attr: 'src' },
        { selector: 'embed[src]', attr: 'src' },
        { selector: 'object[data]', attr: 'data' },
        { selector: 'iframe[src]', attr: 'src' },
        { selector: 'a[href]', attr: 'href' }
    ];

    elements.forEach(({ selector, attr }) => {
        doc.querySelectorAll(selector).forEach(element => {
            const value = element.getAttribute(attr);
            if (value && !value.startsWith('data:') && !value.startsWith('#') && !value.startsWith('javascript:') && !value.startsWith('mailto:')) {
                try {
                    if (!value.startsWith('http')) {
                        const absoluteUrl = new URL(value, baseUrl);
                        element.setAttribute(attr, absoluteUrl.href);
                    }
                } catch (e) {
                    console.warn(`Invalid ${attr} URL:`, value);
                }
            }
        });
    });

    // Process inline styles for background images
    doc.querySelectorAll('[style]').forEach(element => {
        let style = element.getAttribute('style');
        if (style && style.includes('url(')) {
            style = style.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (match, url) => {
                if (!url.startsWith('http') && !url.startsWith('data:')) {
                    try {
                        const absoluteUrl = new URL(url, baseUrl);
                        return `url('${absoluteUrl.href}')`;
                    } catch (e) {
                        return match;
                    }
                }
                return match;
            });
            element.setAttribute('style', style);
        }
    });

    // Process CSS in style tags
    doc.querySelectorAll('style').forEach(styleElement => {
        let css = styleElement.textContent;
        if (css && css.includes('url(')) {
            css = css.replace(/url\(['"]?([^'")\s]+)['"]?\)/g, (match, url) => {
                if (!url.startsWith('http') && !url.startsWith('data:')) {
                    try {
                        const absoluteUrl = new URL(url, baseUrl);
                        return `url('${absoluteUrl.href}')`;
                    } catch (e) {
                        return match;
                    }
                }
                return match;
            });
            styleElement.textContent = css;
        }
    });

    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

function extractResources(htmlContent, baseUrl) {
    const resources = new Set();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    const addResource = (url, type) => {
        try {
            if (!url || url.startsWith('data:') || url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) {
                return;
            }

            const fullUrl = new URL(url, baseUrl).href;
            const urlObj = new URL(fullUrl);
            const baseUrlObj = new URL(baseUrl);

            // Include same domain resources and common CDNs
            if (urlObj.hostname === baseUrlObj.hostname || isAllowedExternalResource(urlObj.hostname)) {
                const localPath = getLocalPath(fullUrl, type);
                resources.add(JSON.stringify({ url: fullUrl, type, path: localPath }));
            }
        } catch (e) {
            console.warn('Invalid resource URL:', url);
        }
    };

    // Helper function to check allowed external resources
    const isAllowedExternalResource = (hostname) => {
        const allowedDomains = [
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'cdnjs.cloudflare.com',
            'cdn.jsdelivr.net',
            'unpkg.com',
            'use.fontawesome.com',
            'maxcdn.bootstrapcdn.com',
            'stackpath.bootstrapcdn.com'
        ];
        return allowedDomains.some(domain => hostname.includes(domain));
    };

    // Extract CSS files (stylesheets)
    doc.querySelectorAll('link[rel="stylesheet"], link[type="text/css"], link[href*=".css"]').forEach(link => {
        const href = link.getAttribute('href');
        if (href) addResource(href, 'css');
    });

    // Extract JavaScript files
    doc.querySelectorAll('script[src], script[type="text/javascript"], script[type="module"]').forEach(script => {
        const src = script.getAttribute('src');
        if (src) addResource(src, 'js');
    });

    // Extract ALL types of images
    doc.querySelectorAll('img[src], img[data-src], img[data-lazy-src], img[data-original]').forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
        if (src) addResource(src, 'image');

        // Handle srcset for responsive images
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
        if (srcset) {
            srcset.split(',').forEach(srcItem => {
                const url = srcItem.trim().split(' ')[0];
                if (url) addResource(url, 'image');
            });
        }
    });

    // Extract picture and source elements
    doc.querySelectorAll('picture source[srcset], picture source[src], source[src], source[srcset]').forEach(source => {
        const src = source.getAttribute('src');
        const srcset = source.getAttribute('srcset');
        if (src) addResource(src, 'image');
        if (srcset) {
            srcset.split(',').forEach(srcItem => {
                const url = srcItem.trim().split(' ')[0];
                if (url) addResource(url, 'image');
            });
        }
    });

    // Extract background images from inline CSS
    doc.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style');
        if (style) {
            const urlMatches = style.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
            if (urlMatches) {
                urlMatches.forEach(match => {
                    const url = match.replace(/url\(['"]?([^'")\s]+)['"]?\)/, '$1');
                    addResource(url, 'image');
                });
            }
        }
    });

    // Extract background images from CSS in style tags
    doc.querySelectorAll('style').forEach(style => {
        const cssText = style.textContent;
        if (cssText) {
            const urlMatches = cssText.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
            if (urlMatches) {
                urlMatches.forEach(match => {
                    const url = match.replace(/url\(['"]?([^'")\s]+)['"]?\)/, '$1');
                    addResource(url, 'image');
                });
            }
        }
    });

    // Extract favicons and icons
    doc.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"], link[rel="mask-icon"]').forEach(icon => {
        const href = icon.getAttribute('href');
        if (href) addResource(href, 'icon');
    });

    // Extract fonts
    doc.querySelectorAll('link[rel="preload"][as="font"], link[href*=".woff"], link[href*=".woff2"], link[href*=".ttf"], link[href*=".otf"], link[href*=".eot"]').forEach(font => {
        const href = font.getAttribute('href');
        if (href) addResource(href, 'font');
    });

    // Extract video and audio sources
    doc.querySelectorAll('video[src], video source[src], audio[src], audio source[src], video[poster]').forEach(media => {
        const src = media.getAttribute('src');
        const poster = media.getAttribute('poster');
        if (src) addResource(src, 'media');
        if (poster) addResource(poster, 'image');
    });

    // Extract other resources
    doc.querySelectorAll('embed[src], object[data], iframe[src]').forEach(element => {
        const src = element.getAttribute('src') || element.getAttribute('data');
        if (src) addResource(src, 'resource');
    });

    // Extract all links with downloadable content
    doc.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href && href.match(/\.(pdf|zip|rar|doc|docx|xls|xlsx|ppt|pptx|mp3|mp4|avi|mov|jpg|png|gif|svg)$/i)) {
            addResource(href, 'download');
        }
    });

    // Extract meta tag resources
    doc.querySelectorAll('meta[content]').forEach(meta => {
        const content = meta.getAttribute('content');
        const property = meta.getAttribute('property') || meta.getAttribute('name');
        if (content && (property === 'og:image' || property === 'twitter:image' || property === 'og:video')) {
            addResource(content, 'meta');
        }
    });

    // Extract manifest files
    doc.querySelectorAll('link[rel="manifest"]').forEach(manifest => {
        const href = manifest.getAttribute('href');
        if (href) addResource(href, 'manifest');
    });

    // Extract preload resources
    doc.querySelectorAll('link[rel="preload"]').forEach(preload => {
        const href = preload.getAttribute('href');
        if (href) {
            const as = preload.getAttribute('as') || 'resource';
            addResource(href, as);
        }
    });

    return Array.from(resources).map(r => JSON.parse(r));
}

function extractLinks(htmlContent, baseUrl) {
    const links = new Set();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        if (href) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                // Only consider links within the same domain
                if (new URL(absoluteUrl).hostname === baseDomain && !visitedUrls.has(absoluteUrl)) {
                    links.add(absoluteUrl);
                }
            } catch (e) {
                console.warn('Invalid link URL:', href);
            }
        }
    });
    return Array.from(links);
}


function isValidResourceUrl(url) {
    try {
        const urlObj = new URL(url);
        // Allow same domain resources
        if (urlObj.hostname === new URL(baseUrl).hostname) {
            return true;
        }
        // Allow common CDNs and external resources
        const allowedDomains = [
            'cdnjs.cloudflare.com',
            'cdn.jsdelivr.net',
            'unpkg.com',
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'use.fontawesome.com'
        ];
        return allowedDomains.some(domain => urlObj.hostname.includes(domain));
    } catch (e) {
        return false;
    }
}

function getLocalPath(url, type) {
    try {
        const urlObj = new URL(url, baseUrl);
        let pathname = urlObj.pathname;

        // Handle root path
        if (pathname === '/' || pathname === '') {
            return 'index.html';
        }

        // Remove leading slash
        if (pathname.startsWith('/')) {
            pathname = pathname.slice(1);
        }

        // Get the last part of the path
        const parts = pathname.split('/').filter(part => part.length > 0);
        let fileName = parts[parts.length - 1];

        // If no extension, treat as directory and add index.html
        if (!fileName || !fileName.includes('.')) {
            const folderPath = parts.join('/');
            return folderPath ? `${folderPath}/index.html` : 'index.html';
        }

        // Return the full path without leading slash
        return parts.join('/');
    } catch (e) {
        return `assets/file_${Date.now()}`;
    }
}

async function downloadResources(resources, baseUrl, signal) {
    if (resources.length === 0) return;

    let completed = 0;
    const maxConcurrent = 3; // Reduced concurrency to avoid timeouts

    for (let i = 0; i < resources.length; i += maxConcurrent) {
        if (signal.aborted) break;

        const chunk = resources.slice(i, i + maxConcurrent);

        await Promise.allSettled(chunk.map(async (resource) => {
            try {
                const content = await fetchResource(resource.url, signal);
                if (content && (typeof content === 'string' || content instanceof ArrayBuffer)) {
                    addFile(resource.path, content, getMimeType(resource.type));
                    completed++;
                    updateStatus('🔄 Loading...', 'info');
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.warn(`Failed to download ${resource.url}:`, error.message);
                }
            }
        }));

        // Small delay between chunks
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

async function fetchResource(url, signal) {
    const isImage = /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp)(\?.*)?$/i.test(url);

    try {
        const response = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': isImage ? 'image/*' : '*/*',
                'Referer': 'https://google.com'
            },
            signal
        }, 10000);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        if (isImage) {
            return await response.arrayBuffer();
        } else {
            return await response.text();
        }
    } catch (error) {
        // Try with CORS proxy as fallback
        try {
            const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
            const response = await fetchWithTimeout(proxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': isImage ? 'image/*' : '*/*'
                },
                signal
            }, 8000);

            if (response.ok) {
                if (isImage) {
                    return await response.arrayBuffer();
                } else {
                    return await response.text();
                }
            }
        } catch (e) {
            // Try AllOrigins for non-images only
            if (!isImage) {
                try {
                    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                    const response = await fetchWithTimeout(proxyUrl, { signal }, 8000);
                    if (response.ok) {
                        const data = await response.json();
                        return data.contents;
                    }
                } catch (e) {
                    // Silent fail
                }
            }
        }
        throw error;
    }
}

function getMimeType(pathOrType) {
    const mimeMap = {
        // Web files
        'html': 'text/html',
        'htm': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'mjs': 'application/javascript',
        'jsx': 'application/javascript',
        'ts': 'application/typescript',
        'tsx': 'application/typescript',
        'json': 'application/json',
        'xml': 'application/xml',
        'php': 'application/x-php',
        'asp': 'application/x-asp',
        'jsp': 'application/x-jsp',

        // Images
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'tiff': 'image/tiff',
        'tif': 'image/tiff',
        'avif': 'image/avif',
        'heic': 'image/heic',
        'heif': 'image/heif',

        // Fonts
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'ttf': 'font/ttf',
        'eot': 'application/vnd.ms-fontobject',
        'otf': 'font/otf',

        // Video
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'ogg': 'video/ogg',
        'ogv': 'video/ogg',
        'avi': 'video/x-msvideo',
        'mov': 'video/quicktime',
        'wmv': 'video/x-ms-wmv',
        'flv': 'video/x-flv',
        'mkv': 'video/x-matroska',
        '3gp': 'video/3gpp',

        // Audio
        'mp3': 'audio/mpeg',
        'wav': 'audio/wav',
        'flac': 'audio/flac',
        'aac': 'audio/aac',
        'ogg': 'audio/ogg',
        'oga': 'audio/ogg',
        'wma': 'audio/x-ms-wma',
        'm4a': 'audio/mp4',

        // Documents
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain',
        'rtf': 'application/rtf',

        // Archives
        'zip': 'application/zip',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        'tar': 'application/x-tar',
        'gz': 'application/gzip',
        'bz2': 'application/x-bzip2',

        // Other
        'manifest': 'application/manifest+json',
        'webmanifest': 'application/manifest+json',
        'appcache': 'text/cache-manifest',
        'map': 'application/json',
        'wasm': 'application/wasm'
    };

    const extension = pathOrType.split('.').pop().toLowerCase();
    if (mimeMap[extension]) {
        return mimeMap[extension];
    }

    // Fallback for general types
    if (pathOrType.startsWith('image/')) return pathOrType;
    if (pathOrType.startsWith('font/')) return pathOrType;
    if (pathOrType.startsWith('video/')) return pathOrType;
    if (pathOrType.startsWith('audio/')) return pathOrType;
    if (pathOrType === 'css') return 'text/css';
    if (pathOrType === 'js') return 'application/javascript';

    return 'application/octet-stream'; // Default binary type
}

function addFile(path, content, mimeType) {
    let size;
    if (content instanceof ArrayBuffer) {
        size = content.byteLength;
    } else {
        size = new Blob([content]).size;
    }
    downloadedFiles.push({ path, content, mimeType, size });
    totalSize += size;
}

async function createZipArchive() {
    // Load JSZip
    if (typeof JSZip === 'undefined') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }

    const zip = new JSZip();

    // Add all files
    downloadedFiles.forEach(file => {
        if (file.content instanceof ArrayBuffer) {
            zip.file(file.path, file.content);
        } else {
            zip.file(file.path, file.content);
        }
    });

    // Add README
    const readme = `Website Source Download
======================

Downloaded: ${new Date().toLocaleString()}
Total Files: ${downloadedFiles.length}
Total Size: ${formatBytes(totalSize)}

Powered by: Alqulol Team

Instructions:
- Open index.html in your browser to view the website
- All resources are organized in folders
- Some external resources may not work offline
`;

    zip.file('README.txt', readme);

    return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function showDownloadSection(zipBlob) {
    const downloadSection = document.getElementById('downloadSection');
    const downloadLink = document.getElementById('downloadLink');
    const fileCount = document.getElementById('fileCount');
    const fileSize = document.getElementById('fileSize');

    const url = URL.createObjectURL(zipBlob);
    downloadLink.href = url;

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    downloadLink.download = `website-source-${timestamp}.zip`;

    fileCount.textContent = downloadedFiles.length;
    fileSize.textContent = formatBytes(totalSize);

    downloadSection.classList.remove('hidden');

    downloadLink.addEventListener('click', () => {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { once: true });
}

function updateStatus(message, type = 'info') {
    const status = document.getElementById('status');
    const statusText = status.querySelector('.status-text');
    const statusIcon = status.querySelector('.status-icon');

    statusText.textContent = message;
    status.classList.remove('hidden');

    // Remove all type classes
    status.classList.remove('info', 'success', 'warning', 'error');

    // Add the appropriate type class
    status.classList.add(type);

    // Update icon based on type
    const spinner = statusIcon.querySelector('.status-spinner');
    if (type === 'info' && message.includes('⬇️')) {
        if (!spinner) {
            statusIcon.innerHTML = '<div class="status-spinner"></div>';
        }
    } else if (type === 'success') {
        statusIcon.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        statusIcon.style.background = 'rgba(0, 210, 106, 0.2)';
        statusIcon.style.color = 'var(--success)';
    } else if (type === 'error') {
        statusIcon.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        statusIcon.style.background = 'rgba(255, 71, 87, 0.2)';
        statusIcon.style.color = 'var(--error)';
    } else if (type === 'warning') {
        statusIcon.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        statusIcon.style.background = 'rgba(255, 184, 0, 0.2)';
        statusIcon.style.color = 'var(--warning)';
    } else {
        if (!spinner) {
            statusIcon.innerHTML = '<div class="status-spinner"></div>';
        }
        statusIcon.style.background = 'rgba(0, 102, 255, 0.1)';
        statusIcon.style.color = 'var(--primary-blue)';
    }

    // Reset any inline styles
    status.style.background = '';
    status.style.borderLeftColor = '';
    status.style.color = '';
    status.style.fontSize = '';
    status.style.fontWeight = '';
    status.style.textAlign = '';
    status.style.padding = '';
    status.style.border = '';
    status.style.borderRadius = '';
    status.style.animation = '';
}

function showError(message) {
    updateStatus(`❌ ${message}`, 'error');
}

// Enhanced URL validation function
function validateAndNormalizeUrl(url) {
    try {
        // Check for basic format
        if (!url || typeof url !== 'string') {
            return { isValid: false, error: 'Please enter a valid website URL' };
        }

        // Remove extra spaces and normalize
        url = url.trim();
        
        // Check for dangerous protocols
        if (url.startsWith('file://') || url.startsWith('ftp://') || url.startsWith('javascript:')) {
            return { isValid: false, error: 'Invalid URL protocol. Please use HTTP or HTTPS URLs only.' };
        }

        // Add https if no protocol specified
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        // Validate URL format
        const urlObj = new URL(url);
        
        // Check for valid hostname
        if (!urlObj.hostname || urlObj.hostname.length === 0) {
            return { isValid: false, error: 'Invalid domain name. Please enter a valid website URL.' };
        }

        // Check for localhost or internal IPs (basic security)
        if (urlObj.hostname === 'localhost' || 
            urlObj.hostname.startsWith('127.') || 
            urlObj.hostname.startsWith('192.168.') || 
            urlObj.hostname.startsWith('10.') ||
            urlObj.hostname.includes('0.0.0.0')) {
            return { isValid: false, error: 'Cannot download from local or internal network addresses.' };
        }

        return { 
            isValid: true, 
            url: url,
            hostname: urlObj.hostname 
        };
    } catch (error) {
        return { isValid: false, error: 'Invalid URL format. Please enter a valid website URL (e.g., https://example.com)' };
    }
}

// Test if URL is reachable
async function testUrlReachability(url) {
    try {
        // Create a quick test request with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(url, {
            method: 'HEAD', // Use HEAD to avoid downloading content
            signal: controller.signal,
            mode: 'no-cors' // Allow cross-origin requests
        });
        
        clearTimeout(timeoutId);
        
        return { isReachable: true };
    } catch (error) {
        if (error.name === 'AbortError') {
            return { isReachable: false, error: 'Website is taking too long to respond. Please check the URL and try again.' };
        }
        return { isReachable: false, error: 'Cannot reach the website. Please check the URL and your internet connection.' };
    }
}

// Progress bar functions
function initializeProgressBar() {
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressPercentage = document.getElementById('progressPercentage');
    const progressComplete = document.getElementById('progressComplete');
    
    // Show progress container
    progressContainer.classList.remove('hidden');
    
    // Reset progress
    progressFill.style.width = '0%';
    progressPercentage.textContent = '0%';
    progressComplete.classList.add('hidden');
}

function updateProgress(percentage, message = '') {
    const progressFill = document.getElementById('progressFill');
    const progressPercentage = document.getElementById('progressPercentage');
    const statusText = document.querySelector('.status-text');
    
    // Ensure percentage is between 0 and 100
    percentage = Math.max(0, Math.min(100, percentage));
    
    // Update progress bar
    progressFill.style.width = `${percentage}%`;
    progressPercentage.textContent = `${percentage}%`;
    
    // Update status message if provided
    if (message) {
        statusText.textContent = message;
    }
}

function showProgressComplete() {
    const progressComplete = document.getElementById('progressComplete');
    progressComplete.classList.remove('hidden');
    
    // Add celebration animation
    progressComplete.style.animation = 'fadeIn 0.5s ease-out';
}

// Helper function to update crawling progress
function updateCrawlProgress(message) {
    const progressBase = 15; // Start from 15% after initial setup
    const progressRange = 65; // Use 65% for crawling (15% to 80%)
    const estimatedTotalPages = Math.max(5, crawledPages.length + 3); // Dynamic estimate
    const currentProgress = progressBase + (crawledPages.length / estimatedTotalPages) * progressRange;
    updateProgress(Math.min(80, Math.round(currentProgress)), message);
}

async function showAlquLolWarning() {
    const status = document.getElementById('status');
    const statusText = status.querySelector('.status-text');
    const statusIcon = status.querySelector('.status-icon');

    // Get user's IP address
    let userIP = 'Unknown';

    try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        userIP = ipData.ip;
    } catch (e) {
        try {
            const ipResponse = await fetch('https://ipapi.co/json/');
            const ipData = await ipResponse.json();
            userIP = ipData.ip;
        } catch (e2) {
            console.warn('Could not fetch IP address');
        }
    }

    statusText.innerHTML = `
        <div style="text-align: center; line-height: 1.6; font-family: 'Poppins', sans-serif; max-width: 400px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ff2d55, #ff1744); padding: 20px; border-radius: 12px; margin-bottom: 15px; box-shadow: 0 8px 25px rgba(255, 23, 68, 0.3);">
                <div style="font-size: 1.4em; margin-bottom: 8px; color: white; font-weight: 700;">
                    🔥 ACCESS DENIED 🔥
                </div>
                <div style="font-size: 0.9em; color: rgba(255, 255, 255, 0.9); font-weight: 500;">
                    Protected Domain
                </div>
            </div>

            <div style="background: rgba(255, 45, 85, 0.1); padding: 18px; border-radius: 10px; border: 2px solid rgba(255, 45, 85, 0.3);">
                <div style="font-size: 1.1em; color: #ff4757; font-weight: 600; margin-bottom: 8px;">
                    Kharkos, you're trying to steal your daddy's website!
                </div>
                <div style="font-size: 0.85em; color: rgba(255, 255, 255, 0.7); margin-bottom: 10px;">
                    IP: ${userIP}
                </div>
            </div>
        </div>
    `;
    status.classList.remove('hidden');

    // Warning icon
    statusIcon.innerHTML = `
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M12 9V13M12 17H12.01M10.29 3.86L1.82 18A2 2 0 0 0 3.54 21H20.46A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    // Simplified styling
    status.style.background = 'rgba(30, 30, 35, 0.95)';
    status.style.border = '2px solid #ff2d55';
    status.style.borderRadius = '16px';
    status.style.boxShadow = '0 0 30px rgba(255, 45, 85, 0.4)';
    status.style.animation = 'warningPulse 2s ease-in-out infinite';
    status.style.padding = '30px';
    status.style.maxWidth = '500px';
    status.style.margin = '20px auto';

    statusIcon.style.background = 'linear-gradient(135deg, #ff2d55, #ff1744)';
    statusIcon.style.color = '#ffffff';
    statusIcon.style.border = '2px solid rgba(255, 45, 85, 0.8)';
    statusIcon.style.width = '60px';
    statusIcon.style.height = '60px';
    statusIcon.style.boxShadow = '0 0 20px rgba(255, 45, 85, 0.5)';

    statusText.style.color = '#ffffff';
    statusText.style.fontSize = '1em';
    statusText.style.fontWeight = '500';

    // Warning animation
    if (!document.querySelector('#warningPulseStyle')) {
        const style = document.createElement('style');
        style.id = 'warningPulseStyle';
        style.textContent = `
            @keyframes warningPulse {
                0%, 100% { 
                    box-shadow: 0 0 30px rgba(255, 45, 85, 0.4);
                }
                50% { 
                    box-shadow: 0 0 40px rgba(255, 45, 85, 0.6);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // EXTREMELY LOUD AND INTENSE SECURITY ALERT SOUND SYSTEM
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // MAXIMUM VOLUME ALERT SYSTEM
        const playLoudTone = (frequency, duration, delay = 0, waveType = 'square', volume = 0.8) => {
            setTimeout(() => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                const compressor = audioContext.createDynamicsCompressor();

                oscillator.connect(gainNode);
                gainNode.connect(compressor);
                compressor.connect(audioContext.destination);

                oscillator.type = waveType;
                oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);

                // MAXIMUM VOLUME ENVELOPE
                gainNode.gain.setValueAtTime(0, audioContext.currentTime);
                gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime + duration * 0.8);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

                oscillator.start();
                oscillator.stop(audioContext.currentTime + duration);
            }, delay);
        };

        // INTENSE MULTI-LAYER SECURITY ALERT SEQUENCE
        // Layer 1: SCREAMING HIGH ALERTS
        playLoudTone(2000, 0.3, 0, 'square', 0.9);      // LOUD ALARM
        playLoudTone(1500, 0.3, 200, 'square', 0.9);    // LOUD ALARM
        playLoudTone(2000, 0.3, 400, 'square', 0.9);    // LOUD ALARM
        playLoudTone(2500, 0.4, 600, 'square', 0.9);    // SCREAMING HIGH ALERT

        // Layer 2: DEEP BASS WARNINGS
        playLoudTone(100, 1.2, 0, 'sawtooth', 0.7);     // DEEP BASS WARNING
        playLoudTone(80, 1.0, 800, 'sawtooth', 0.7);    // DEEPER BASS WARNING

        // Layer 3: CONTINUOUS SIREN SEQUENCE
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                const sirenOscillator = audioContext.createOscillator();
                const sirenGain = audioContext.createGain();
                const compressor = audioContext.createDynamicsCompressor();

                sirenOscillator.connect(sirenGain);
                sirenGain.connect(compressor);
                compressor.connect(audioContext.destination);

                sirenOscillator.type = 'triangle';
                sirenGain.gain.setValueAtTime(0.6, audioContext.currentTime);

                // RAPID SIREN SWEEP
                sirenOscillator.frequency.setValueAtTime(600, audioContext.currentTime);
                sirenOscillator.frequency.linearRampToValueAtTime(1800, audioContext.currentTime + 0.5);
                sirenOscillator.frequency.linearRampToValueAtTime(600, audioContext.currentTime + 1.0);

                sirenOscillator.start();
                sirenOscillator.stop(audioContext.currentTime + 1.0);
            }, 1000 + (i * 600));
        }

        // Layer 4: FINAL SCREAMING ALERTS
        playLoudTone(3000, 0.5, 3000, 'square', 0.95);   // SCREAMING FINAL ALERT
        playLoudTone(2200, 0.5, 3600, 'square', 0.95);   // SCREAMING FINAL ALERT
        playLoudTone(3500, 0.6, 4200, 'square', 0.95);   // ULTIMATE SCREAMING ALERT

        // Layer 5: CONTINUOUS WARNING BEEPS
        for (let i = 0; i < 8; i++) {
            playLoudTone(1800, 0.2, 5000 + (i * 300), 'square', 0.8);
        }

    } catch (e) {
        console.warn('Could not play security alert sound');

        // FALLBACK: MULTIPLE SYSTEM BEEPS
        try {
            for (let i = 0; i < 10; i++) {
                setTimeout(() => {
                    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmzhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg+ltryxnkpBSl+0fLNeSsFJHfH8N+QQAoUXrTp66hVFApGn+DyvmwhBSZ+0fPTgjMGHm7A7+OZSA8PVqng77BdGAg==');
                    audio.volume = 0.9;
                    audio.play().catch(() => {});
                }, i * 400);
            }
        } catch (e2) {
            // Silent fallback
        }
    }
}

function getErrorMessage(error) {
    const message = error.message.toLowerCase();

    if (message.includes('timeout') || message.includes('timed out')) {
        return 'Connection timed out. The website may be slow or unreachable.';
    }
    if (message.includes('failed to fetch') || message.includes('network')) {
        return 'Network error. Check your internet connection.';
    }
    if (message.includes('404') || message.includes('not found')) {
        return 'Website not found. Please verify the URL is correct.';
    }
    if (message.includes('403') || message.includes('forbidden')) {
        return 'Access denied by the website.';
    }
    if (message.includes('500')) {
        return 'Website server error. Try again later.';
    }
    if (message.includes('bypass') || message.includes('heavily protected')) {
        return 'Website is protected and cannot be downloaded.';
    }
    if (message.includes('cancelled')) {
        return 'Download was cancelled.';
    }

    return 'Failed to download website. Please try a different URL or try again later.';
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Event listeners
document.getElementById('urlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        downloadWebsite();
    }
});

// Load JSZip on page load
window.addEventListener('load', () => {
    loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')
        .catch(() => console.warn('Failed to load JSZip'));
});

// Cancel download with Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && abortController) {
        abortController.abort();
    }
});

// Helper function to get filename from URL, handling directories and index files
function getFileNameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        let pathname = urlObj.pathname;

        // Handle root path
        if (pathname === '/' || pathname === '') {
            return 'index.html';
        }

        // Remove trailing slash
        if (pathname.endsWith('/')) {
            pathname = pathname.slice(1);
        }

        // Get the last part of the path
        const parts = pathname.split('/').filter(part => part.length > 0);
        let fileName = parts[parts.length - 1];

        // If no extension, treat as directory and add index.html
        if (!fileName || !fileName.includes('.')) {
            const folderPath = parts.join('/');
            return folderPath ? `${folderPath}/index.html` : 'index.html';
        }

        // Return the full path without leading slash
        return parts.join('/');
    } catch (e) {
        return 'index.html';
    }
}

// Show status panel and initialize progress
function showStatus() {
    const statusPanel = document.getElementById('status');
    const progressContainer = document.getElementById('progressContainer');
    if (statusPanel) {
        statusPanel.classList.remove('hidden');
    }
    // Hide progress container initially
    if (progressContainer) {
        progressContainer.classList.add('hidden');
    }
}

