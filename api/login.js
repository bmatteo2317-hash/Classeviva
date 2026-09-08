import axios from 'axios';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Metodo non consentito' });
    }

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Credenziali mancanti' });
    }

    try {
        const loginResponse = await axios.post('https://web.spaggiari.eu/rest/v1/auth/login', {
            ident: null,
            pass: password,
            uid: username
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Z-Dev-ApiKey': '+zorro+',
                'User-Agent': 'zorro/1.0'
            }
        });

        const token = loginResponse.data.token;
        const userId = loginResponse.data.data.release.replace(/\D/g, '');

        const gradesResponse = await axios.get(`https://web.spaggiari.eu/rest/v1/students/${userId}/grades`, {
            headers: {
                'Z-Dev-ApiKey': '+zorro+',
                'User-Agent': 'zorro/1.0',
                'Z-Auth-Token': token
            }
        });

        const voti = gradesResponse.data.grades || [];
        
        let totaleVoti = 0;
        let conteggioVoti = 0;
        let votoMassimo = 0;
        let votoMinimo = 10;
        let materie = {};

        voti.forEach(v => {
            const valore = parseFloat(v.decimalValue || v.decimal);
            const materia = v.subjectDesc;

            if (!isNaN(valore)) {
                totaleVoti += valore;
                conteggioVoti++;
                if (valore > votoMassimo) votoMassimo = valore;
                if (valore < votoMinimo) votoMinimo = valore;

                if (!materie[materia]) {
                    materie[materia] = { somma: 0, conteggio: 0 };
                }
                materie[materia].somma += valore;
                materie[materia].conteggio++;
            }
        });

        const mediaGenerale = conteggioVoti > 0 ? (totaleVoti / conteggioVoti).toFixed(2) : 0;

        const medieMaterie = Object.keys(materie).map(m => ({
            materia: m,
            media: (materie[m].somma / materie[m].conteggio).toFixed(2),
            votiTotali: materie[m].conteggio
        }));

        return res.status(200).json({
            success: true,
            statistiche: {
                mediaGenerale,
                conteggioVoti,
                votoMassimo,
                votoMinimo: votoMinimo === 10 ? 0 : votoMinimo
            },
            medieMaterie
        });

    } catch (error) {
        console.error("Errore API Spaggiari:", error.response?.data || error.message);
        return res.status(500).json({ 
            success: false, 
            error: 'Errore di autenticazione o recupero dati da Classeviva.' 
        });
    }
}