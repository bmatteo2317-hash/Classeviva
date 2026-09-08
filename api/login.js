import axios from 'axios';

const setCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ successo: false, errore: 'Metodo non consentito. Usa POST.' });
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ successo: false, errore: 'Username e password sono obbligatori.' });
  }

  try {
    // 1. Login a Classeviva
    const loginResponse = await axios.post(
      'https://web.spaggiari.eu/rest/v1/auth/login',
      {
        ident: null,
        pass: password,
        uid: username
      },
      {
        headers: {
          'Z-Dev-ApiKey': '+zorro+',
          'User-Agent': 'zorro/1.0',
          'Content-Type': 'application/json'
        }
      }
    );

    const token = loginResponse.data?.data?.token;
    const rawRelease = loginResponse.data?.data?.release ?? '';
    const userId = String(rawRelease).replace(/\D/g, '');

    if (!token || !userId) {
      return res.status(401).json({ successo: false, errore: 'Login fallito: risposta non valida dal server Classeviva.' });
    }

    // 2. GET dei voti
    const gradesResponse = await axios.get(
      `https://web.spaggiari.eu/rest/v1/students/${userId}/grades`,
      {
        headers: {
          'Z-Dev-ApiKey': '+zorro+',
          'User-Agent': 'zorro/1.0',
          'Z-Auth-Token': token
        }
      }
    );

    const grades = gradesResponse.data?.data ?? gradesResponse.data?.grades ?? [];

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
    const message =
      error.response?.data?.error?.message ??
      error.response?.data?.message ??
      error.message ??
      'Errore sconosciuto';
    return res.status(status).json({ successo: false, errore: message });
  }
}
