// Fuente única de verdad sobre Pablo. El agente solo puede responder con lo que está aquí.
// Para actualizar el agente basta con editar este archivo.

export const profile = {
  name: 'Pablo Galeana Bailey',
  headline: 'Senior Platform Engineer | Cloud, Kubernetes, DevOps y automatización de seguridad',
  location: 'México (remoto)',
  yearsOfExperience: 'más de 14 años',
  summary:
    'Senior Platform Engineer con más de 14 años construyendo y operando plataformas en AWS. ' +
    'Especialista en Kubernetes (Amazon EKS), Terraform, GitOps, CI/CD y confiabilidad en producción. ' +
    'Ha liderado modernización a la nube, gobierno de seguridad en múltiples cuentas de AWS, ' +
    'automatización con Python y seguridad de plataforma. Hoy enfocado también en infraestructura para IA generativa ' +
    '(AWS Bedrock) y optimización de costos en la nube.',
  languages: [
    { language: 'Español', level: 'nativo' },
    { language: 'Inglés', level: 'intermedio (trabaja en inglés técnico)' },
  ],
  contact: {
    email: '1ngbyt3@gmail.com',
    linkedin: 'https://www.linkedin.com/in/pablo-galeana-bailey/',
    github: 'https://github.com/IngMatrix-PGB',
  },
};

export const certifications = [
  { name: 'AWS Certified DevOps Engineer – Professional', issuer: 'Amazon Web Services' },
  { name: 'AWS Certified Developer – Associate', issuer: 'Amazon Web Services' },
  { name: 'AWS Certified AI Practitioner', issuer: 'Amazon Web Services' },
];

export const experience = [
  {
    id: 'clubhub',
    company: 'ClubHub.ai',
    role: 'Senior Platform Engineer',
    period: 'jun 2025 – hoy',
    highlights: [
      'Lidera evaluaciones de la plataforma Kubernetes de producción en varios clústeres de Amazon EKS, con hojas de ruta de remediación priorizadas.',
      'Diseñó herramientas en Python para analizar workloads de Kubernetes, estado de Terraform, IAM y repositorios GitOps.',
      'Implementó gobierno de AWS Security Hub y GuardDuty a nivel organización con Terraform en múltiples cuentas.',
      'Habilitó AWS Config y la administración delegada de Security Hub.',
      'Lidera análisis de causa raíz de incidentes de producción en Kubernetes: discos llenos, drift de GitOps y fallas de workloads.',
      'Diseñó evaluaciones de resiliencia: PodDisruptionBudgets, topologySpreadConstraints, probes y anti-afinidad.',
      'Apoyó la habilitación de AWS Bedrock para iniciativas de IA generativa.',
      'Diseñó un marco de descubrimiento de infraestructura asistido por IA para Terraform y GitOps, con aprobación humana para todo cambio.',
    ],
  },
  {
    id: 'nubiral',
    company: 'Nubiral',
    role: 'Platform Engineer',
    period: 'feb 2023 – jun 2025',
    highlights: [
      'Diseñó y operó plataformas de alta disponibilidad en AWS con EKS, ECS y arquitecturas multi-cuenta.',
      'Desarrolló módulos de Terraform reutilizables que estandarizaron IaC entre proyectos.',
      'Implementó gobierno de seguridad centralizado con AWS Organizations, Security Hub y GuardDuty con administración delegada, todo en Terraform.',
      'Lideró migraciones de Teradata on-premises a AWS: conectividad segura, migración por fases y arquitectura.',
      'Orquestación de datos con AWS Glue, Step Functions y Apache Airflow.',
      'Flujos GitOps con GitLab CI/CD y GitHub Actions.',
      'Contribuyó al proyecto AWS SSO Reporter para visibilidad de IAM Identity Center en multi-cuenta.',
    ],
  },
  {
    id: 'clip',
    company: 'Clip',
    role: 'Python / DevOps Engineer',
    period: 'jul 2021 – ene 2023',
    highlights: [
      'Operó entornos de producción en AWS ECS (EC2 y Fargate).',
      'Construyó y operó plataformas Kubernetes en Amazon EKS y Google Kubernetes Engine (GKE).',
      'Redes seguras con IAM, VPC, ALB y Route 53.',
      'Módulos de Terraform y CloudFormation para AWS y GCP; entornos híbridos AWS + Google Cloud.',
    ],
  },
  {
    id: 'gbm',
    company: 'Grupo Bursátil Mexicano (GBM)',
    role: 'DevOps Engineer',
    period: 'jun 2017 – jun 2021',
    highlights: [
      'Lideró la migración de aplicaciones empresariales de on-premises a AWS.',
      'Diseñó y operó plataformas Kubernetes de producción en EKS.',
      'Pipelines de CI/CD con Jenkins, GitLab CI y AWS Developer Tools.',
      'IaC con Terraform y CloudFormation; automatización con Python y Bash.',
      'Respuesta a incidentes, análisis de causa raíz y prácticas de AWS Well-Architected.',
    ],
  },
  {
    id: 'gft',
    company: 'GFT Group México',
    role: 'DevOps Engineer',
    period: 'mar 2015 – jun 2017',
    highlights: [
      'Infraestructura en AWS y Google Cloud para clientes empresariales.',
      'Administración de clústeres Red Hat OpenShift y servidores Linux (RHEL/CentOS).',
      'Administración de MongoDB: replicación, respaldos y tuning.',
      'Plugins de monitoreo propios para Nagios en Bash y Python.',
    ],
  },
  {
    id: 'qk',
    company: 'Quality & Knowledge',
    role: 'Java / Unix Programmer',
    period: 'ene 2009 – ene 2015',
    highlights: [
      'Backend en Java y procesos batch para banca (HSBC y BBVA Bancomer).',
      'SQL y PL/SQL en Oracle para flujos de alto volumen.',
      'Migración de clientes corporativos a BBVA Bancomer Net Cash: transformación de layouts entre ERPs y el banco.',
    ],
  },
];

export const projects = [
  {
    id: 'ayuuk',
    name: 'Ayuuk para Todos',
    period: '2009 – hoy',
    description:
      'Fundador y autor de un diccionario interactivo de la lengua Mixe (ayuuk). Migró el CD original en Flash a una web pública: ' +
      'recuperó 1,174 audios del binario legado, los emparejó con validación cruzada (96% de coincidencia) y los estandarizó a −14 LUFS. ' +
      'Hoy hay 1,191 palabras disponibles desde cualquier celular. El diccionario se presentó en el congreso ICED en 2009.',
  },
  {
    id: 'bedrock-rag',
    name: 'Plataforma RAG en AWS Bedrock',
    period: '2026',
    description:
      'Laboratorio personal de RAG sobre AWS Bedrock con enfoque en costo primero: infraestructura en Terraform, evaluaciones medidas ' +
      'de recuperación, respuesta y guardrails, y CI con pruebas automatizadas. Nada de pago se despliega automáticamente.',
  },
  {
    id: 'habla-con-pablo',
    name: 'Habla con Pablo',
    period: '2026',
    description:
      'Este mismo agente de voz: WebRTC con OpenAI Realtime, herramientas que consultan su perfil, tokens temporales emitidos por el servidor, ' +
      'límite diario por IP y métricas de latencia en vivo.',
  },
];

export const education = [
  {
    degree: 'Licenciatura en Informática',
    school: 'Instituto Tecnológico del Istmo (Juchitán, Oaxaca)',
    period: '2000 – 2005',
  },
];

export const teachingAndPublications = [
  'Catedrático de medio tiempo en Ingeniería en Sistemas Computacionales, UGM campus Matías Romero (2007 – 2009).',
  'Artículo sobre DevOps en AWS en Centripio Magazine #02 (octubre 2017).',
  'Artículo sobre Terraform en Centripio Magazine #03 (diciembre 2017).',
];

export const skills = {
  cloud: ['AWS (EKS, ECS, Lambda, Organizations, Security Hub, GuardDuty, Config, Bedrock, Glue, Step Functions)', 'Google Cloud (GKE)'],
  kubernetes: ['Amazon EKS', 'GKE', 'Red Hat OpenShift', 'Helm', 'Argo CD / GitOps', 'Karpenter'],
  iac: ['Terraform', 'Atlantis', 'CloudFormation'],
  cicd: ['GitHub Actions', 'GitLab CI', 'Jenkins'],
  observability: ['Grafana', 'Prometheus', 'Loki', 'CloudWatch', 'Nagios'],
  security: ['Gobierno multi-cuenta en AWS', 'IAM e IRSA', 'SCPs', 'Security Hub / CIS'],
  languages: ['Python', 'Bash', 'Java', 'SQL / PL-SQL'],
  ai: ['AWS Bedrock', 'RAG', 'Agentes y LLMs', 'Voz en tiempo real'],
  data: ['AWS Glue', 'Apache Airflow', 'Step Functions', 'MongoDB', 'Oracle', 'PostgreSQL'],
};
