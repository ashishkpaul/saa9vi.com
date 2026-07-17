export function LoginFooter() {
    const isDev = import.meta.env.MODE === 'development';

    return (
        <div className="text-center text-xs text-muted-foreground mt-6">
            Powered by Saa9vi
            <br />
            {isDev ? (
                <span className="text-amber-500">Development Environment</span>
            ) : (
                <span>Education Commerce Operating System</span>
            )}
        </div>
    );
}
