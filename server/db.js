const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'clinica.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      price REAL NOT NULL,
      image TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS professionals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      bio TEXT NOT NULL,
      photo TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS professional_services (
      professional_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      PRIMARY KEY (professional_id, service_id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      service_id INTEGER NOT NULL,
      professional_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmado',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (professional_id) REFERENCES professionals(id)
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_prof_date
      ON appointments(professional_id, date);

    CREATE INDEX IF NOT EXISTS idx_appointments_lookup
      ON appointments(email, phone);

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  const countRow = db.prepare('SELECT COUNT(*) AS count FROM services').get();
  if (!countRow || countRow.count === 0) {
    seedDb();
  }

  db.exec(`
    UPDATE services SET image = REPLACE(image, '.svg', '.jpg') WHERE image LIKE '%.svg';
    UPDATE professionals SET photo = REPLACE(photo, '.svg', '.jpg') WHERE photo LIKE '%.svg';
  `);
}

function seedDb() {
  const services = [
    {
      id: 1,
      name: 'Limpeza de Pele Profunda',
      category: 'Facial',
      description: 'Higienização profunda com extração delicada, alta frequência e máscara calmante personalizada para renovar a luminosidade da pele.',
      duration_min: 60,
      price: 180.0,
      image: '/assets/img/svc-limpeza.jpg'
    },
    {
      id: 2,
      name: 'Peeling de Diamante',
      category: 'Facial',
      description: 'Microdermoabrasão suave que promove renovação celular, uniformiza a textura cutânea e atenua poros dilatados e linhas finas.',
      duration_min: 60,
      price: 220.0,
      image: '/assets/img/svc-peeling.jpg'
    },
    {
      id: 3,
      name: 'Harmonização Facial',
      category: 'Injetáveis',
      description: 'Protocolo personalizado com preenchedores e bioestimuladores para realçar contornos faciais com equilíbrio, simetria e naturalidade.',
      duration_min: 90,
      price: 1850.0,
      image: '/assets/img/svc-harmonizacao.jpg'
    },
    {
      id: 4,
      name: 'Toxina Botulínica',
      category: 'Injetáveis',
      description: 'Aplicação precisa para suavizar linhas de expressão e prevenir rugas dinâmicas, preservando a expressão natural do rosto.',
      duration_min: 30,
      price: 1100.0,
      image: '/assets/img/svc-botox.jpg'
    },
    {
      id: 5,
      name: 'Preenchimento Labial',
      category: 'Injetáveis',
      description: 'Definição de contorno, hidratação profunda e volume sutil com ácido hialurônico de alta tecnologia e biocompatibilidade.',
      duration_min: 60,
      price: 1350.0,
      image: '/assets/img/svc-labial.jpg'
    },
    {
      id: 6,
      name: 'Drenagem Linfática',
      category: 'Corporal',
      description: 'Massagem com manobras suaves e ritmadas que reduz a retenção hídrica, melhora a circulação e promove bem-estar imediato.',
      duration_min: 60,
      price: 160.0,
      image: '/assets/img/svc-drenagem.jpg'
    },
    {
      id: 7,
      name: 'Massagem Modeladora',
      category: 'Corporal',
      description: 'Manobras intensas e localizadas para remodelar o contorno corporal, ativar o metabolismo local e melhorar a firmeza da pele.',
      duration_min: 60,
      price: 175.0,
      image: '/assets/img/svc-massagem.jpg'
    },
    {
      id: 8,
      name: 'Depilação a Laser',
      category: 'Laser',
      description: 'Tecnologia de ponteira resfriada para redução progressiva e duradoura dos pelos com máximo conforto para todos os fototipos.',
      duration_min: 30,
      price: 240.0,
      image: '/assets/img/svc-laser.jpg'
    }
  ];

  const professionals = [
    {
      id: 1,
      name: 'Dra. Helena Duarte',
      role: 'Biomédica Esteta',
      bio: 'Especialista em harmonização orofacial e procedimentos injetáveis minimamente invasivos, com foco em resultados elegantes e naturais.',
      photo: '/assets/img/prof-helena.jpg',
      serviceIds: [2, 3, 4, 5, 8]
    },
    {
      id: 2,
      name: 'Dra. Camila Rocha',
      role: 'Dermatologista',
      bio: 'Médica dermatologista dedicada ao rejuvenescimento global, protocolos clínicos avançados e tecnologias a laser.',
      photo: '/assets/img/prof-camila.jpg',
      serviceIds: [1, 2, 3, 4, 5, 8]
    },
    {
      id: 3,
      name: 'Juliana Prado',
      role: 'Esteticista',
      bio: 'Especialista em cosmetologia avançada e tratamentos faciais e corporais de alto desempenho para saúde e vitalidade da pele.',
      photo: '/assets/img/prof-juliana.jpg',
      serviceIds: [1, 2, 6, 7, 8]
    },
    {
      id: 4,
      name: 'Marina Alves',
      role: 'Fisioterapeuta Dermatofuncional',
      bio: 'Fisioterapeuta referência em reabilitação estética, drenagem linfática especializada, remodelagem corporal e laserterapia.',
      photo: '/assets/img/prof-marina.jpg',
      serviceIds: [1, 6, 7, 8]
    }
  ];

  const insertService = db.prepare(`
    INSERT INTO services (id, name, category, description, duration_min, price, image)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertProf = db.prepare(`
    INSERT INTO professionals (id, name, role, bio, photo)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertProfService = db.prepare(`
    INSERT INTO professional_services (professional_id, service_id)
    VALUES (?, ?)
  `);

  db.exec('BEGIN');
  try {
    for (const s of services) {
      insertService.run(s.id, s.name, s.category, s.description, s.duration_min, s.price, s.image);
    }
    for (const p of professionals) {
      insertProf.run(p.id, p.name, p.role, p.bio, p.photo);
      for (const sid of p.serviceIds) {
        insertProfService.run(p.id, sid);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

initDb();

module.exports = db;
