use clap::{crate_version, App, Arg};
use futures::try_join;
use futures::SinkExt;
use futures::{StreamExt, TryStreamExt};
use num_cpus;
use optic_diff_engine::diff_interaction;
use optic_diff_engine::errors;
use optic_diff_engine::streams;
use optic_diff_engine::HttpInteraction;
use optic_diff_engine::InteractionDiffResult;
use optic_diff_engine::SpecEvent;
use optic_diff_engine::SpecProjection;
use std::cmp;
use std::process;
use std::sync::Arc;
use tokio::io::{stdin, stdout};
use tokio::sync::mpsc;

fn main() {
  let cli = App::new("Optic Diff engine")
    .version(crate_version!())
    .author("Optic Labs Corporation")
    .about("Detects differences between API spec and captured interactions")
    .arg(
      Arg::with_name("specification")
        .required(true)
        .value_name("spec-file-path")
        .help("Sets the specification file that describes the API spec")
        .takes_value(true),
    )
    .arg(
      Arg::with_name("core-threads")
        .long("core-threads")
        .takes_value(true)
        .required(false)
        .hidden(true)
        .help(
          "Sets the amount of threads used. Defaults to amount of cores available to the system.",
        ),
    );

  let matches = cli.get_matches();

  let spec_file_path = matches
    .value_of("specification")
    .expect("spec-file-path should be required");
  let core_threads_count: Option<u16> = match clap::value_t!(matches.value_of("core-threads"), u16)
  {
    Ok(count) => Some(count),
    Err(e) => match e.kind {
      clap::ErrorKind::ArgumentNotFound => None,
      _ => {
        e.exit();
      }
    },
  };

  let events = SpecEvent::from_file(spec_file_path)
    .map_err(|err| match err {
      errors::EventLoadingError::Io(err) => {
        eprintln!("Could not read specification file: {}", err);
        process::exit(1);
      }
      errors::EventLoadingError::Json(err) => {
        eprintln!("Specification JSON file could not be parsed: {}", err);
        process::exit(1);
      }
      _ => unreachable!("Specification file not currently serialized as any other but JSON"),
    })
    .unwrap();

  let spec_projection = Arc::new(SpecProjection::from(events));

  let mut runtime_builder = tokio::runtime::Builder::new();
  runtime_builder.enable_all();
  runtime_builder.threaded_scheduler();
  if let Some(core_threads) = core_threads_count {
    runtime_builder
      .max_threads((core_threads as usize) * 2)
      .core_threads(core_threads as usize);
  }

  let mut runtime = runtime_builder.build().unwrap();
  runtime.block_on(async {
    let stdin = stdin(); // TODO: deal with std in never having been attached

    let interaction_lines = streams::http_interaction::json_lines(stdin);

    let (results_sender, mut results_receiver) = mpsc::channel(32); // buffer 32 results

    // set amount of diff tasks queued to be proportional to the amount of threads we'll be using
    let diff_queue_size = cmp::min(
      num_cpus::get(),
      core_threads_count.unwrap_or(num_cpus::get() as u16) as usize,
    ) * 4;
    eprintln!("using diff size {}", diff_queue_size);

    let results_manager = tokio::spawn(async move {
      let stdout = stdout();
      let mut results_sink = streams::diff::into_json_lines(stdout);

      while let Some(result) = results_receiver.recv().await {
        if let Err(_) = results_sink.send(result).await {
          panic!("could not write diff result to stdout"); // TODO: Find way to actually write error info
        }
      }
    });

    tokio::pin!(results_manager);

    dbg!("waiting for next interaction");

    let diffing_interactions = async move {
      let diff_results = interaction_lines
        .map(Ok)
        .try_for_each_concurrent(diff_queue_size, |interaction_json_result| {
          let projection = spec_projection.clone();
          let mut results_sender = results_sender.clone();

          let diff_task = tokio::spawn(async move {
            let diff_comp = tokio::task::spawn_blocking::<
              _,
              Option<(Vec<InteractionDiffResult>, Tags)>,
            >(move || {
              let interaction_json =
                interaction_json_result.expect("can read interaction json line from stdin");
              let TaggedInput(interaction, tags): TaggedInput<HttpInteraction> =
                match serde_json::from_str(&interaction_json) {
                  Ok(tagged_interaction) => tagged_interaction,
                  Err(parse_error) => {
                    eprintln!("could not parse interaction json: {}", parse_error);
                    return None;
                  }
                };

              Some((diff_interaction(&projection, interaction), tags))
            });
            //dbg!("waiting for results");
            let results = diff_comp
              .await
              .expect("diffing of interaction should be successful");
            //dbg!("got results");

            if let Some((results, tags)) = results {
              for result in results {
                //dbg!(&result);
                if let Err(_) = results_sender
                  .send(ResultContainer::from((result, &tags)))
                  .await
                {
                  panic!("could not write diff result to results channel");
                  // TODO: Find way to actually write error info
                }
              }
            }
          });

          diff_task
        })
        .await;

      dbg!("interactions stream closed");

      drop(results_sender);
      diff_results
    };

    try_join!(diffing_interactions, results_manager).expect("essential worker task panicked");
  })
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct TaggedInput<T>(T, Tags);
#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct ResultContainer<T>(T, Tags, String);
type Tags = Vec<String>;

impl From<(InteractionDiffResult, &Tags)> for ResultContainer<InteractionDiffResult> {
  fn from((result, tags): (InteractionDiffResult, &Tags)) -> Self {
    let fingerprint = result.fingerprint();
    Self(result, tags.clone(), fingerprint)
  }
}

#[cfg(test)]
mod test {
  #[test]
  pub fn do_a_diff() {
    assert_eq!(true, true, "wouldn't you know");
  }
}
