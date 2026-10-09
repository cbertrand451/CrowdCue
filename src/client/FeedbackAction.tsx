import { LoadingButton } from './LoadingButton';
export function FeedbackAction({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="feedback-action">
      <p role="alert">{message}</p>
      <LoadingButton
        loading={loading}
        className="secondary"
        onClick={onRetry}
        loadingLabel="Refreshing requests…"
      >
        Retry requests
      </LoadingButton>
    </div>
  );
}
