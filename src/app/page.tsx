export default function ClosedPage() {
  return (
    <main className="flex flex-col items-center justify-center px-6 py-20 text-center max-w-2xl mx-auto">
      {/* Logo */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1B2A4A]/10 mb-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#1B2A4A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
      </div>

      {/* Titre */}
      <h1 className="text-3xl font-bold text-[#1B2A4A] mb-2">FlowDataGouv</h1>
      <p className="text-lg text-[#7F8C8D] mb-8">
        Étude sur l&apos;Open Data français - Janvier à Mars 2026
      </p>

      {/* Message */}
      <div className="bg-gray-50 rounded-xl p-8 mb-8 border border-gray-100">
        <p className="text-[#1B2A4A] text-base leading-relaxed">
          ❤️ Ce projet de recherche et développement est désormais clôturé.
          <br />
          <br />
          Merci à tous ceux qui ont exploré, testé et contribué à cette étude
          sur les données publiques françaises. Le code source reste librement
          accessible pour quiconque souhaite s&apos;en inspirer ou construire
          son propre outil.
        </p>
      </div>

      {/* Boutons */}
      <div className="flex flex-col sm:flex-row gap-4 mb-10">
        <a
          href="https://github.com/FLI-GCT/FlowDataGouv"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#1B2A4A] text-white font-medium hover:bg-[#2E75B6] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          Code source sur GitHub
        </a>
        <a
          href="https://github.com/datagouv/mcp-data.gouv.fr"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#2E75B6] text-white font-medium hover:bg-[#1B2A4A] transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          MCP officiel data.gouv.fr
        </a>
      </div>

      {/* Signature */}
      <div className="text-sm text-[#7F8C8D]">
        <p>
          Projet de{" "}
          <a
            href="https://www.linkedin.com/in/guillaume-clement-erp-cloud/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2E75B6] hover:underline"
          >
            Guillaume CLEMENT
          </a>
        </p>
        <p className="mt-1 text-xs">
          Développé avec Claude (Anthropic) et Mistral AI - Licence MIT
        </p>
      </div>
    </main>
  );
}
