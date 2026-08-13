import type { LoaderFunction } from "react-router";
import { data as json, useLoaderData, useNavigate } from "react-router";
import LoginModal from "~/components/LoginModal";
import { auth } from "~/services/auth.server";
import { isGoogleAuthenticationConfigured } from "~/services/google-auth.server";
import { getSafeAuthenticationReturnTo } from "~/utils/authRedirect";

const ERROR_MESSAGES: Record<string, string> = {
  configuration:
    "Google-inloggningen är inte färdigkonfigurerad. Kontakta administratören.",
  invalid_flow: "Inloggningen hann löpa ut. Försök igen.",
  not_allowed: "Det här Google-kontot har inte behörighet till administrationen.",
  not_verified: "Google-kontots e-postadress är inte verifierad.",
  account_conflict:
    "Google-kontot är redan kopplat till en annan användare. Kontakta administratören.",
  provider_error: "Google-inloggningen kunde inte slutföras. Försök igen.",
};

type LoaderData = {
  configured: boolean;
  errorMessage: string | null;
  returnTo: string;
};

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const returnTo = getSafeAuthenticationReturnTo(
    url.searchParams.get("returnTo")
  );
  await auth.isAuthenticated(request, {
    successRedirect: returnTo,
  });

  const error = url.searchParams.get("error");
  return json<LoaderData>({
    configured: isGoogleAuthenticationConfigured(),
    errorMessage: error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.provider_error : null,
    returnTo,
  });
};

export default function Login() {
  const { configured, errorMessage, returnTo } = useLoaderData<LoaderData>();
  const navigate = useNavigate();

  return (
    <div className="mcc-login-page">
      <LoginModal
        configured={configured}
        errorMessage={errorMessage}
        onClose={() => navigate("/")}
        returnTo={returnTo}
      />
    </div>
  );
}
