import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosaver, type SaveFn, type SaveState } from "./autosave";

type V = { title: string };

function setup(save = vi.fn<SaveFn<V>>(async () => null)) {
  const states: SaveState[] = [];
  const errors: (string | null)[] = [];
  const saver = new Autosaver<V>(
    { title: "a" },
    {
      save,
      delay: 1000,
      valid: (v) => v.title.trim() !== "",
      onState: (s, e) => {
        states.push(s);
        errors.push(e);
      },
    },
  );
  return { saver, save, states, errors };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Autosaver", () => {
  it("grava só depois da pausa, com o último valor", async () => {
    const { saver, save, states } = setup();
    saver.update({ title: "ab" });
    saver.update({ title: "abc" });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ title: "abc" }, { title: "a" });
    expect(states.at(-1)).toBe("saved");
    expect(saver.isClean()).toBe(true);
  });

  it("não grava valor igual ao já gravado", async () => {
    const { saver, save, states } = setup();
    saver.update({ title: "ab" });
    saver.update({ title: "a" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe("idle");
  });

  it("não grava valor inválido e avisa", async () => {
    const { saver, save, states } = setup();
    saver.update({ title: "  " });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe("invalid");
    expect(await saver.flush()).toBe(false);
  });

  it("flush grava na hora e informa se ficou tudo gravado", async () => {
    const { saver, save } = setup();
    saver.update({ title: "x" });
    expect(await saver.flush()).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("serializa: o que muda durante a gravação é salvo em seguida, comparado ao novo gravado", async () => {
    let release!: () => void;
    const save = vi.fn<SaveFn<V>>(() => new Promise((r) => (release = () => r(null))));
    const { saver } = setup(save);
    saver.update({ title: "b" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    // Volta ao valor original enquanto "b" ainda grava: precisa regravar "a".
    saver.update({ title: "a" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ title: "a" }, { title: "b" });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.isClean()).toBe(true);
  });

  it("erro fica visível, não marca como gravado e um novo valor tenta de novo", async () => {
    const save = vi.fn<SaveFn<V>>(async (v) => (v.title === "ruim" ? "falhou" : null));
    const { saver, states, errors } = setup(save);
    saver.update({ title: "ruim" });
    expect(await saver.flush()).toBe(false);
    expect(states.at(-1)).toBe("error");
    expect(errors.at(-1)).toBe("falhou");
    saver.update({ title: "bom" });
    expect(await saver.flush()).toBe(true);
    expect(states.at(-1)).toBe("saved");
  });

  it("exceção na gravação vira erro", async () => {
    const save = vi.fn<SaveFn<V>>(async () => {
      throw new Error("rede");
    });
    const { saver, errors } = setup(save);
    saver.update({ title: "x" });
    expect(await saver.flush()).toBe(false);
    expect(errors.at(-1)).toBe("rede");
  });

  it("cancel descarta o pendente", async () => {
    const { saver, save } = setup();
    saver.update({ title: "x" });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await saver.flush()).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
