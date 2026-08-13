import { useState } from "react";

export type JournalEntrySide = "debit" | "credit";

type JournalEntryAmounts = {
  debit: number;
  credit: number;
};

type JournalEntryAmountFieldProps = JournalEntryAmounts & {
  id: string;
  onChange: (amounts: JournalEntryAmounts) => void;
};

const amountValue = (value: number) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

export const journalEntrySide = ({ debit, credit }: JournalEntryAmounts) => {
  if (amountValue(credit) > 0 && amountValue(debit) === 0) return "credit";
  if (amountValue(debit) > 0) return "debit";
  return null;
};

export const journalEntryAmountsForSide = (
  amounts: JournalEntryAmounts,
  side: JournalEntrySide
): JournalEntryAmounts => {
  const currentSide = journalEntrySide(amounts);
  const amount = currentSide ? amountValue(amounts[currentSide]) : 0;
  return side === "debit"
    ? { debit: amount, credit: 0 }
    : { debit: 0, credit: amount };
};

const sideOptions: Array<{ side: JournalEntrySide; label: string }> = [
  { side: "debit", label: "Debet" },
  { side: "credit", label: "Kredit" },
];

export default function JournalEntryAmountField({
  credit,
  debit,
  id,
  onChange,
}: JournalEntryAmountFieldProps) {
  const [emptySide, setEmptySide] = useState<JournalEntrySide>(
    () => journalEntrySide({ debit, credit }) ?? "debit"
  );
  const activeSide = journalEntrySide({ debit, credit }) ?? emptySide;
  const amount = amountValue(activeSide === "debit" ? debit : credit);
  const amountInputId = `${id}-amount`;

  const selectSide = (side: JournalEntrySide) => {
    setEmptySide(side);
    onChange(journalEntryAmountsForSide({ debit, credit }, side));
  };

  const updateAmount = (value: string) => {
    const nextAmount = value === "" ? 0 : Number(value);
    onChange(
      activeSide === "debit"
        ? { debit: nextAmount, credit: 0 }
        : { debit: 0, credit: nextAmount }
    );
  };

  return (
    <div className="min-w-0">
      <div className="flex min-h-9 flex-wrap items-center gap-1">
        <div
          role="group"
          aria-label="Välj debet eller kredit"
          className="inline-flex items-center gap-1"
        >
          {sideOptions.map(({ side, label }) => {
            const active = activeSide === side;
            return (
              <button
                key={side}
                type="button"
                aria-pressed={active}
                onClick={() => selectSide(side)}
                className={`inline-flex h-8 items-center justify-center gap-2 rounded-lg px-2 text-[10px] font-bold uppercase tracking-[0.08em] transition ${
                  active
                    ? "text-[#985744]"
                    : "text-stone-400 hover:bg-stone-100/70 hover:text-stone-600"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 rounded-full transition-all duration-200 ${
                    active ? "w-[1.35rem] bg-[#b86e59]" : "w-1.5 bg-[#cdc6bd]"
                  }`}
                />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <label
        htmlFor={amountInputId}
        className="mt-1 block border-b border-stone-300 pb-2 transition focus-within:border-[#ad644f]"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-stone-500">
          Belopp
        </span>
        <span className="mt-1.5 flex items-baseline gap-2">
          <input
            id={amountInputId}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount || ""}
            onChange={(event) => updateAmount(event.target.value)}
            placeholder="0,00"
            className="verification-amount-input min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-xl font-semibold leading-none tabular-nums text-stone-900 outline-none placeholder:text-stone-300"
          />
          <span className="shrink-0 text-[11px] font-bold uppercase text-stone-400">
            kr
          </span>
        </span>
      </label>
    </div>
  );
}
