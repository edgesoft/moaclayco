  // Funktion för att formatera månadens namn
export const formatMonthName = (yearMonth: string) => {
    const [year, month] = yearMonth.split("-");
    const monthNames = [
      "Januari",
      "Februari",
      "Mars",
      "April",
      "Maj",
      "Juni",
      "Juli",
      "Augusti",
      "September",
      "Oktober",
      "November",
      "December",
    ];
    return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
  };
  