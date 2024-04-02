export const formatDateToUTC = (d: Date) => {
    if (!d) return ""
    const date = new Date(d);
    const year = date.getUTCFullYear();
    const month = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Lägger till en nolla framför och tar de två sista siffrorna för att säkerställa MM-format
    const day = ('0' + date.getUTCDate()).slice(-2); // Lägger till en nolla framför och tar de två sista siffrorna för att säkerställa DD-format
    const hours = ('0' + date.getUTCHours()).slice(-2);
    const minutes = ('0' + date.getUTCMinutes()).slice(-2);
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };
  