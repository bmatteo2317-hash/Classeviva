import axios from 'axios';

// Header funzionanti (verificati il 2026-09-08):
// la vecchia coppia "+zorro+" / "zorro/1.0" viene rifiutata con
// 400 "203:CvvRestApi/apikey.3". La libreria aggiornata aiocvv usa questi:
const API_KEY = 'Tg1NWEwNGIgIC0K';
const USER_AGENT = 'CVVS/std/4.1.7 Android/10';

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const loginHeaders = () => ({
  'Z-Dev-Apikey': API_KEY,
  'User-Agent': USER_AGENT,
  'Content-Type': 'application/json'
});

const authHeaders = (token) => ({
  ...loginHeaders(),
  'Z-Auth-Token': token
});

// La risposta di /auth/login e' un oggetto FLAT:
// { ident, firstName, lastName, token, release, expire }
// (non wrappato in data.data). Supportiamo comunque entrambe le forme.
function parseLoginPayload(body) {
  const payload = body?.data && (body.data.token || body.data.ident) ? body.data : body;
  return payload ?? {};
}

function extractClassevivaError(error) {
  const data = error.response?.data;
  // Classeviva restituisce { statusCode, error: "stringa", info?: "stringa" }
  // dove error e' una STRINGA, non un oggetto: il vecchio parsing
  // (data.error.message) restituiva undefined e finiva in
  // "Request failed with status code 403".
  if (typeof data?.error === 'string') {
    return data.info ? `${data.error} (${data.info})` : data.error;
  }
  if (typeof data?.message === 'string') return data.message;
  if (typeof data === 'string') return data;
  return error.message ?? 'Errore sconosciuto';
}

function friendlyMessage(raw, status) {
  const s = String(raw ?? '');
  if (s.includes('WrongCredentials') || s.includes('authentication failed') || status === 422 || status === 403) {
    return 'Credenziali non valide: controlla username e password su Classeviva.';
  }
  if (s.includes('apikey')) {
    return 'Chiave API rifiutata dal server Classeviva (' + s + '). Aggiorna la function.';
  }
  if (s.includes('not authorized') || s.includes('incompatible')) {
    return 'Token non autorizzato per questo studente (' + s + '). Riprova il login.';
  }
  return s || 'Errore durante il login.';
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ successo: false, errore: 'Metodo non consentito. Usa POST.' });
  }

  const { username, password, ident } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ successo: false, errore: 'Username e password sono obbligatori.' });
  }

  try {
    // 1. Login a Classeviva (come fa aiocvv: solo uid/pass, ident solo se fornito)
    const loginBody = { uid: username, pass: password };
    if (ident) loginBody.ident = ident;

    const loginResponse = await axios.post(
      'https://web.spaggiari.eu/rest/v1/auth/login',
      loginBody,
      { headers: loginHeaders(), timeout: 15000 }
    );

    const payload = parseLoginPayload(loginResponse.data);

    // Account genitore con piu' identita': Classeviva chiede di scegliere l'ident
    if (payload.choices) {
      const choices = payload.choices.map((c) => `${c.ident} (${c.name})`).join(', ');
      return res.status(422).json({
        successo: false,
        errore: 'Account con piu\' identita\': riprova passando ident. Scelte: ' + choices,
        scelte: payload.choices
      });
    }

    const token = payload.token;
    // L'id studente si ricava da "ident" (es. "S1234567X" -> "1234567"),
    // NON da "release" che e' un timestamp.
    const identRaw = payload.ident ?? '';
    const userId = String(identRaw).replace(/\D/g, '');

    if (!token || !userId) {
      return res.status(401).json({ successo: false, errore: 'Login fallito: risposta non valida dal server Classeviva.' });
    }

    // 2. GET dei voti
    const gradesResponse = await axios.get(
      `https://web.spaggiari.eu/rest/v1/students/${userId}/grades`,
      { headers: authHeaders(token), timeout: 15000 }
    );

    const gdata = gradesResponse.data;
    const grades = Array.isArray(gdata) ? gdata : (gdata?.grades ?? gdata?.data ?? []);

    // 3. Calcolo statistiche
    const votiNumerici = [];
    const perMateria = {};

    for (const g of grades) {
      const rawValue = g.decimalValue ?? g.value ?? g.mark;
      const value = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue ?? '').replace(',', '.'));
      if (Number.isNaN(value)) continue;

      const materia = g.subjectDesc ?? g.subject ?? g.materia ?? 'Materia sconosciuta';

      votiNumerici.push(value);

      if (!perMateria[materia]) {
        perMateria[materia] = { voti: [], somma: 0 };
      }
      perMateria[materia].voti.push({
        voto: value,
        data: g.evtDate ?? g.date ?? null,
        descrizione: g.notesForFamily ?? g.desc ?? '',
        tipo: g.componentDesc ?? ''
      });
      perMateria[materia].somma += value;
    }

    const votiTotali = votiNumerici.length;
    const sommaTotale = votiNumerici.reduce((a, b) => a + b, 0);
    const mediaGenerale = votiTotali > 0 ? sommaTotale / votiTotali : 0;
    const votoMax = votiTotali > 0 ? Math.max(...votiNumerici) : null;
    const votoMin = votiTotali > 0 ? Math.min(...votiNumerici) : null;

    const mediePerMateria = Object.entries(perMateria).map(([materia, info]) => ({
      materia,
      media: info.somma / info.voti.length,
      numeroVoti: info.voti.length,
      voti: info.voti
    }));

    mediePerMateria.sort((a, b) => a.materia.localeCompare(b.materia, 'it'));

    return res.status(200).json({
      successo: true,
      dati: {
        mediaGenerale: Math.round(mediaGenerale * 100) / 100,
        votiTotali,
        votoMax,
        votoMin,
        mediePerMateria
      }
    });
  } catch (error) {
    const status = error.response?.status ?? 500;
    const raw = extractClassevivaError(error);
    // Log server-side per debug su Vercel (vercel logs)
    console.error('Classeviva error:', status, raw);
    return res.status(status).json({ successo: false, errore: friendlyMessage(raw, status), dettaglio: raw });
  }
}
