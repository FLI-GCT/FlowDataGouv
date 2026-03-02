import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="border-t px-4 py-6">
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
        <p>
          Open source &middot; Donnees{" "}
          <a
            href="https://www.data.gouv.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            data.gouv.fr
          </a>
          {" "}via{" "}
          <a
            href="https://github.com/datagouv/datagouv-mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            MCP data.gouv.fr
          </a>
        </p>
        <div className="flex items-center gap-4">
          <Link href="/explore" className="hover:text-foreground hover:underline">
            Explorer
          </Link>
          <Link href="/mcp" className="hover:text-foreground hover:underline">
            MCP
          </Link>
        </div>
      </div>
    </footer>
  );
}
