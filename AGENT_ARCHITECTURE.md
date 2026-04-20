# Arquitectura de Agentes — Song Chords (Android)

## Vision General

```
                     Usuario
                       |
               ┌───────┴───────┐
               │  Orchestrator  │
               │  (Opus 4.6)    │
               └───┬───┬───┬───┘
                   │   │   │
        ┌──────────┘   │   └──────────┐
        │              │              │
  ┌─────┴─────┐  ┌────┴─────┐  ┌─────┴─────┐
  │ Compose UI │  │  Data    │  │  Quality   │
  │   Agent    │  │  Agent   │  │   Agent    │
  │ (Sonnet)   │  │ (Sonnet) │  │ (Sonnet)   │
  └────────────┘  └──────────┘  └────────────┘
```

## Agentes

### 1. Orchestrator (Claude Opus)
- Punto de entrada principal
- Analiza solicitudes y delega a especialistas
- Gestiona memoria del proyecto
- Responde en español

### 2. Compose UI Agent (Claude Sonnet)
**Dominio**: `packages/android/app/src/main/java/com/songchords/app/ui/`
- Jetpack Compose screens, layouts, modifiers
- Material 3 components (TopAppBar, NavigationBar, Cards, Dialogs)
- Navigation Compose (NavHost, routes)
- Canvas API (chord diagrams)
- Animations, gestures

### 3. Data Layer Agent (Claude Sonnet)
**Dominio**: `data/`, `viewmodel/`, `parser/`, `transpose/`
- Room Database (entities, DAOs, migrations)
- ViewModels + StateFlow
- Repositories (suspend functions, Flow queries)
- ChordPro parser (Kotlin)
- Transposer (Kotlin)
- DataStore settings

### 4. Quality Agent (Claude Sonnet)
**Dominio**: Todo el proyecto (Android + Desktop)
- JUnit tests (parser, transposer)
- Compose UI tests
- Code review (coroutine safety, Compose stability)
- Gradle builds
- Feature parity audits (Android vs Desktop)

## Uso

```bash
# Configurar API key
cp agents/.env.example agents/.env
# Editar agents/.env con tu ANTHROPIC_API_KEY

# Modo interactivo
yarn agents

# Comandos directos a especialistas
/compose <tarea>   # → Compose UI Agent
/data <tarea>      # → Data Layer Agent
/quality <tarea>   # → Quality Agent
```

## Estructura de Archivos

```
agents/
├── index.ts                 # CLI interactivo
├── orchestrator/agent.ts    # Orchestrator con 3 delegation tools
├── compose-ui/agent.ts      # Compose UI Agent
├── data-layer/agent.ts      # Data Layer Agent
├── android-quality/agent.ts # Quality Agent
├── shared/
│   ├── config.ts            # Paths del proyecto, modelos
│   ├── context.ts           # Builder de contexto para cada agente
│   ├── memory.ts            # CRUD para Claude Memory
│   ├── tools.ts             # 8 tools base (read, write, edit, glob, grep, shell, memory)
│   ├── agent-runner.ts      # Agentic loop genérico
│   ├── types.ts             # Tipos compartidos
│   └── index.ts             # Barrel exports
└── package.json
```

## Memoria del Proyecto

```
~/.claude/projects/<project-hash>/memory/
  MEMORY.md                          # Índice
  project_song_chords.md             # Overview del proyecto
  reference_agent_architecture.md    # Esta arquitectura
  user_paul_preferences.md           # Preferencias del usuario
```
