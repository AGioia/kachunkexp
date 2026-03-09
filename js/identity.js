// ═══════════════════════════════════════════════════
// KaChunk — Identity System (Dormant)
// 
// Silently generates a cryptographic identity on first launch.
// No UI exposed — this runs invisibly until activated.
// 
// The identity is:
//   - An Ed25519 keypair (via Web Crypto API, fallback to ECDSA P-256)
//   - A random handle (e.g., "kachunk-a7f3")
//   - Stored in IndexedDB (more secure than localStorage for keys)
//
// Future use: chunk authorship, sharing, marketplace, cross-device portability
// ═══════════════════════════════════════════════════

const DB_NAME = 'kachunk_identity';
const DB_VERSION = 1;
const STORE_NAME = 'identity';
const IDENTITY_KEY = 'primary';

// ─── IndexedDB helpers ───

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Key Generation ───

function generateHandle() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  const arr = crypto.getRandomValues(new Uint8Array(4));
  for (let i = 0; i < 4; i++) {
    suffix += chars[arr[i] % chars.length];
  }
  return 'kachunk-' + suffix;
}

async function generateKeypair() {
  try {
    // Try ECDSA P-256 (widely supported in Web Crypto)
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable — needed for export/portability later
      ['sign', 'verify']
    );
    
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    
    return {
      algorithm: 'ECDSA-P256',
      publicKey: publicKeyJwk,
      privateKey: privateKeyJwk
    };
  } catch (e) {
    console.warn('[KaChunk Identity] Web Crypto keygen failed, using fallback:', e);
    // Fallback: random bytes as a pseudo-identity (no signing capability)
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return {
      algorithm: 'random-fallback',
      publicKey: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''),
      privateKey: null
    };
  }
}

// ─── Public API ───

let _identityCache = null;

/**
 * Initialize identity silently. Call once at app startup.
 * Creates keypair + handle if none exists.
 */
export async function initIdentity() {
  try {
    const db = await openDB();
    let identity = await dbGet(db, IDENTITY_KEY);
    
    if (!identity) {
      const keys = await generateKeypair();
      identity = {
        version: 1,
        handle: generateHandle(),
        created: new Date().toISOString(),
        ...keys
      };
      await dbPut(db, IDENTITY_KEY, identity);
      // Identity created silently
    }
    
    _identityCache = identity;
    return identity;
  } catch (e) {
    console.warn('[KaChunk] Identity init failed (non-critical):', e);
    return null;
  }
}

/**
 * Get the current identity (cached after init).
 */
export function getIdentity() {
  return _identityCache;
}

/**
 * Get just the public key (safe to share/embed in chunks).
 */
export function getPublicKey() {
  return _identityCache ? _identityCache.publicKey : null;
}

/**
 * Get the handle.
 */
export function getHandle() {
  return _identityCache ? _identityCache.handle : null;
}

/**
 * Sign arbitrary data with the identity's private key.
 * Returns base64-encoded signature, or null if signing unavailable.
 */
export async function signData(data) {
  if (!_identityCache || _identityCache.algorithm === 'random-fallback') return null;
  
  try {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      _identityCache.privateKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      encoded
    );
    
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  } catch (e) {
    console.warn('[KaChunk] Signing failed:', e);
    return null;
  }
}

/**
 * Verify a signature against a public key.
 */
export async function verifySignature(data, signatureB64, publicKeyJwk) {
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    
    const encoded = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
    const sigBytes = Uint8Array.from(atob(signatureB64), c => c.charCodeAt(0));
    
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sigBytes,
      encoded
    );
  } catch (e) {
    console.warn('[KaChunk] Verification failed:', e);
    return false;
  }
}
