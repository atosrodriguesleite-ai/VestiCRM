/**
 * Esqueleto de carregamento compartilhado por todas as telas do app.
 * Aparece NA HORA em que o usuário troca de aba — a resposta visual é
 * imediata enquanto o servidor prepara a página (sem tela travada).
 */
export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto animate-fade-in" aria-busy="true" aria-label="Carregando">
      {/* título da página */}
      <div className="mb-6">
        <div className="skeleton h-7 w-48 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded-lg mt-2" />
      </div>

      {/* linha de cards de métrica */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-surface rounded-2xl border border-slate-200/70 shadow-card p-4 md:p-5"
          >
            <div className="skeleton h-3 w-20 rounded mb-3" />
            <div className="skeleton h-7 w-24 rounded" />
          </div>
        ))}
      </div>

      {/* blocos de conteúdo */}
      <div className="grid lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 bg-surface rounded-2xl border border-slate-200/70 shadow-card p-5 space-y-3">
          <div className="skeleton h-4 w-36 rounded" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton size-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3.5 w-2/3 rounded" />
                <div className="skeleton h-3 w-1/3 rounded" />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-surface rounded-2xl border border-slate-200/70 shadow-card p-5 space-y-3">
          <div className="skeleton h-4 w-32 rounded" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-10 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
