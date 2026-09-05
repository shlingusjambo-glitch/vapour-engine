use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use std::hint::black_box;
use vapour_render::{PassKind, RenderGraph, ResourceKind};

fn compile_graph(pass_count: usize) {
    let mut graph = RenderGraph::default();
    let mut previous = graph.import_resource("frame-input", ResourceKind::Texture);

    for index in 0..pass_count {
        let output = graph.create_resource(format!("transient-{index}"), ResourceKind::Texture);
        graph
            .add_pass(
                format!("pass-{index}"),
                PassKind::Render,
                [previous],
                [output],
            )
            .expect("benchmark graph must be valid");
        previous = output;
    }

    black_box(graph.compile().expect("benchmark graph must compile"));
}

fn render_graph_benchmark(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("render_graph_compile");
    for pass_count in [16, 64, 256] {
        group.bench_with_input(
            BenchmarkId::from_parameter(pass_count),
            &pass_count,
            |bencher, pass_count| bencher.iter(|| compile_graph(*pass_count)),
        );
    }
    group.finish();
}

criterion_group!(benches, render_graph_benchmark);
criterion_main!(benches);
