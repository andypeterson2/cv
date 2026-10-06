from railway_sdk import define_railway, github, preserve, project, service, volume

# A partial: this repository owns the cv service and its volume, so a plan from
# here leaves cloudflared alone.
PARTIAL = "cv"


@define_railway
def main(_ctx=None):
    # The database lives on this volume. Leaving it undeclared makes a plan from
    # here propose detaching it, so it is owned alongside the service it serves.
    data = volume("cv-volume", {"region": "sfo", "sizeMB": 5000})
    cv = service(
        "cv",
        # Railway builds this one from git, unlike the services that are pushed
        # from CI, so the source and the watch paths belong in the plan.
        source=github("andypeterson2/cv", branch="main", checkSuites=True),
        build={
            "watchPatterns": [
                "editor/**",
                "shared/**",
                "assets/**",
                "Dockerfile",
                ".dockerignore",
            ],
        },
        # Secrets stay dashboard-managed; preserve() marks them as existing and
        # not this file's to define.
        volumeMounts={"/data": data},
        env={
            "CV_DB_PATH": preserve(),
            "CV_EDITOR_TOKEN": preserve(),
            "CV_ORIGIN_SECRET": preserve(),
            "CV_ORIGIN_SECRET_ENFORCE": preserve(),
            "CV_PUBLIC_PERSON_IDS": preserve(),
            "HOST": preserve(),
            "OWNER_EMAIL": preserve(),
        },
    )
    return project("desirable-benevolence", resources=[cv, data])
