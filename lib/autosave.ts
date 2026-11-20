// Salvamento automático: agenda a gravação após uma pausa na edição e serializa as gravações
// (nunca duas ao mesmo tempo; o que mudar durante uma gravação é salvo logo depois).
// Sem React aqui, para ser testável em lib/autosave.test.ts; o hook fica em lib/use-autosave.ts.

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "invalid";

// Recebe o valor a gravar e o último valor gravado (para enviar só o que mudou).
// Devolve a mensagem de erro, ou null quando gravou.
export type SaveFn<T> = (value: T, previous: T) => Promise<string | null>;

export type AutosaverOptions<T> = {
  save?: SaveFn<T>;
  delay: number;
  valid?: (value: T) => boolean;
  onState?: (state: SaveState, error: string | null) => void;
};

const keyOf = (v: unknown) => JSON.stringify(v);

export class Autosaver<T> {
  private latest: T;
  private saved: T;
  private savedKey: string;
  private hasSaved = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private failed = false;

  constructor(
    initial: T,
    private opts: AutosaverOptions<T>,
  ) {
    this.latest = initial;
    this.saved = initial;
    this.savedKey = keyOf(initial);
  }

  /** Troca as funções de gravação/validação (o hook as atualiza a cada renderização). */
  configure(opts: Partial<AutosaverOptions<T>>) {
    this.opts = { ...this.opts, ...opts };
  }

  private valid(v: T) {
    return this.opts.valid ? this.opts.valid(v) : true;
  }

  private emit(state: SaveState, error: string | null = null) {
    this.opts.onState?.(state, error);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Novo valor do formulário. Agenda a gravação se ele difere do último gravado e é válido. */
  update(value: T) {
    this.latest = value;
    this.clearTimer();
    // Durante uma gravação, sempre agenda: a comparação vale contra o que ela acabar gravando.
    if (!this.running) {
      // Um valor novo substitui o que falhou: o erro anterior deixa de valer.
      this.failed = false;
      if (keyOf(value) === this.savedKey) return this.settle();
      if (!this.valid(value)) return this.emit("invalid");
      this.emit("pending");
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.delay);
  }

  /** Grava já o que estiver pendente. Resolve true quando tudo ficou gravado. */
  async flush(): Promise<boolean> {
    this.clearTimer();
    if (this.running) this.again = true;
    else this.running = this.loop().finally(() => (this.running = null));
    await this.running;
    return this.isClean();
  }

  /** Descarta o que estiver pendente (ex.: o registro foi excluído). */
  cancel() {
    this.clearTimer();
    this.latest = this.saved;
    this.again = false;
  }

  /** Nada agendado, nada gravando e o valor atual já está gravado. */
  isClean() {
    return !this.timer && !this.running && !this.failed && keyOf(this.latest) === this.savedKey;
  }

  private async loop() {
    for (;;) {
      this.again = false;
      const value = this.latest;
      const key = keyOf(value);
      if (key === this.savedKey || !this.valid(value)) break;
      this.emit("saving");
      let error: string | null;
      try {
        error = this.opts.save ? await this.opts.save(value, this.saved) : null;
      } catch (e) {
        error = e instanceof Error && e.message ? e.message : "Falha de conexão";
      }
      if (error) {
        this.failed = true;
        this.emit("error", error);
        if (this.again) continue;
        return;
      }
      this.failed = false;
      this.saved = value;
      this.savedKey = key;
      this.hasSaved = true;
      if (!this.again) break;
    }
    this.failed = false;
    this.settle();
  }

  private settle() {
    if (this.failed) return;
    if (keyOf(this.latest) === this.savedKey) return this.emit(this.hasSaved ? "saved" : "idle");
    if (!this.valid(this.latest)) return this.emit("invalid");
    this.emit("pending");
  }
}
